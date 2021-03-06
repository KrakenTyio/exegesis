"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateResponseValidator = exports.generateRequestValidator = exports._filterRequiredProperties = exports._fixNullables = void 0;
const ajv_1 = __importDefault(require("ajv"));
const json_schema_traverse_1 = __importDefault(require("json-schema-traverse"));
const json_schema_resolve_ref_1 = require("../../utils/json-schema-resolve-ref");
const jsonSchema = __importStar(require("../../utils/jsonSchema"));
const mime_1 = require("../../utils/mime");
// urlencoded and form-data requests do not contain any type information;
// for example `?foo=9` doesn't tell us if `foo` is the number 9, or the string
// "9", so we need to use type coercion to make sure the data passed in matches
// our schema.
const REQUEST_TYPE_COERCION_ALLOWED = new mime_1.MimeTypeRegistry({
    "application/x-www-form-urlencoded": true,
    "multipart/form-data": true,
});
// TODO tests
// * readOnly
// * readOnly with additionalProperties and value supplied
// * readOnly not supplied but required
// * writeOnly (all cases as readOnly)
// * Make sure validation errors are correct format.
function assertNever(x) {
    throw new Error("Unexpected object: " + x);
}
function getParameterDescription(parameterLocation) {
    let description = '';
    switch (parameterLocation.in) {
        case 'path':
        case 'server':
        case 'query':
        case 'cookie':
        case 'header':
            description = `${parameterLocation.in} parameter "${parameterLocation.name}"`;
            break;
        case 'request':
        case 'response':
            description = `${parameterLocation.in} body`;
            break;
        default:
            assertNever(parameterLocation.in);
    }
    return description;
}
function addCustomFormats(ajv, customFormats) {
    return Object.keys(customFormats)
        .reduce((result, key) => {
        const customFormat = customFormats[key];
        if (typeof customFormat === 'function' || customFormat instanceof RegExp) {
            result[key] = { type: 'string', validate: customFormat };
        }
        else if (customFormat.type === 'string') {
            result[key] = { type: 'string', validate: customFormat.validate };
        }
        else if (customFormat.type === 'number') {
            result[key] = { type: 'number', validate: customFormat.validate };
        }
        ajv.addFormat(key, result[key]);
        return result;
    }, {});
}
function removeExamples(schema) {
    // ajv will print "schema id ignored" to stdout if an example contains a filed
    // named "id", so just axe all the examples.
    json_schema_traverse_1.default(schema, (childSchema) => {
        if (childSchema.example) {
            delete childSchema.example;
        }
    });
}
function removeReadOnly(schema) {
    json_schema_traverse_1.default(schema, (childSchema) => {
        if (childSchema.properties) {
            Object.keys(childSchema.properties).map((key) => {
                if (childSchema.properties[key].readOnly) {
                    delete childSchema.properties[key];
                }
            });
        }
    });
}
function _fixNullables(schema) {
    json_schema_traverse_1.default(schema, (childSchema) => {
        if (schema.properties) {
            for (const propName of Object.keys(childSchema.properties)) {
                const prop = childSchema.properties[propName];
                const resolvedProp = json_schema_resolve_ref_1.resolveRef(schema, prop);
                if (resolvedProp.nullable) {
                    childSchema.properties[propName] = { anyOf: [{ type: 'null' }, prop] };
                }
            }
        }
        if (childSchema.additionalProperties) {
            const resolvedProp = json_schema_resolve_ref_1.resolveRef(schema, childSchema.additionalProperties);
            if (resolvedProp.nullable) {
                childSchema.additionalProperties = { anyOf: [{ type: 'null' }, childSchema.additionalProperties] };
            }
        }
        if (childSchema.items) {
            const resolvedItems = json_schema_resolve_ref_1.resolveRef(schema, childSchema.items);
            if (resolvedItems.nullable) {
                childSchema.items = { anyOf: [{ type: 'null' }, childSchema.items] };
            }
        }
    });
}
exports._fixNullables = _fixNullables;
function _filterRequiredProperties(schema, propNameToFilter) {
    json_schema_traverse_1.default(schema, (childSchema) => {
        if (childSchema.properties && childSchema.required) {
            for (const propName of Object.keys(childSchema.properties)) {
                const prop = childSchema.properties[propName];
                // Resolve the prop, in case it's a `{$ref: ....}`.
                const resolvedProp = json_schema_resolve_ref_1.resolveRef(schema, prop);
                if (resolvedProp && resolvedProp[propNameToFilter]) {
                    childSchema.required = childSchema.required.filter((r) => r !== propName);
                }
            }
        }
    });
}
exports._filterRequiredProperties = _filterRequiredProperties;
function doValidate(schemaPtr, parameterLocation, parameterRequired, ajvValidate, json) {
    const value = { value: json };
    let errors = null;
    if (json === null || json === undefined) {
        if (parameterRequired) {
            errors = [{
                    message: `Missing required ${getParameterDescription(parameterLocation)}`,
                    location: {
                        in: parameterLocation.in,
                        name: parameterLocation.name,
                        // docPath comes from parameter here, not schema, since the parameter
                        // is the one that defines it is required.
                        docPath: parameterLocation.docPath,
                        path: ''
                    }
                }];
        }
    }
    if (!errors) {
        ajvValidate(value);
        if (ajvValidate.errors) {
            errors = ajvValidate.errors.map(err => {
                let pathPtr = err.dataPath || '';
                if (pathPtr.startsWith("/value")) {
                    pathPtr = pathPtr.slice(6);
                }
                return {
                    message: err.message || 'Unspecified error',
                    location: {
                        in: parameterLocation.in,
                        name: parameterLocation.name,
                        docPath: schemaPtr,
                        path: pathPtr
                    },
                    ajvError: err
                };
            });
        }
    }
    return { errors, value: value.value };
}
function generateValidator(schemaContext, parameterLocation, parameterRequired, propNameToFilter, allowTypeCoercion) {
    const { openApiDoc, jsonPointer: schemaPtr } = schemaContext;
    const customFormats = schemaContext.options.customFormats;
    let schema = jsonSchema.extractSchema(openApiDoc, schemaPtr);
    _filterRequiredProperties(schema, propNameToFilter);
    removeExamples(schema);
    // TODO: Should we do this?  Or should we rely on the schema being correct in the first place?
    // _fixNullables(schema);
    // So that we can replace the "root" value of the schema using ajv's type coercion...
    json_schema_traverse_1.default(schema, node => {
        if (node.$ref) {
            node.$ref = `#/properties/value/${node.$ref.slice(2)}`;
        }
    });
    schema = {
        type: 'object',
        properties: {
            value: schema
        }
    };
    if (['post', 'put'].includes(schemaContext.path[2])) {
        removeReadOnly(schema);
    }
    const ajv = new ajv_1.default({
        useDefaults: true,
        coerceTypes: allowTypeCoercion ? 'array' : false,
        removeAdditional: false,
        jsonPointers: true,
        nullable: true,
        allErrors: schemaContext.options.allErrors,
    });
    addCustomFormats(ajv, customFormats);
    const validate = ajv.compile(schema);
    return function (json) {
        return doValidate(schemaPtr, parameterLocation, parameterRequired, validate, json);
    };
}
function generateRequestValidator(schemaContext, parameterLocation, parameterRequired, mediaType) {
    const allowTypeCoercion = mediaType ? REQUEST_TYPE_COERCION_ALLOWED.get(mediaType) || false : false;
    return generateValidator(schemaContext, parameterLocation, parameterRequired, 'readOnly', allowTypeCoercion);
}
exports.generateRequestValidator = generateRequestValidator;
function generateResponseValidator(schemaContext, parameterLocation, parameterRequired) {
    return generateValidator(schemaContext, parameterLocation, parameterRequired, 'writeOnly', false);
}
exports.generateResponseValidator = generateResponseValidator;
//# sourceMappingURL=validators.js.map