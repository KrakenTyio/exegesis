"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const invoke_1 = require("../controllers/invoke");
const stringToStream_1 = __importDefault(require("../utils/stringToStream"));
const errors_1 = require("../errors");
const bufferToStream_1 = __importDefault(require("../utils/bufferToStream"));
const typeUtils_1 = require("../utils/typeUtils");
const ExegesisContextImpl_1 = __importDefault(require("./ExegesisContextImpl"));
function handleSecurity(operation, context) {
    return __awaiter(this, void 0, void 0, function* () {
        const authenticated = yield operation.authenticate(context);
        context.security = authenticated;
        if (authenticated) {
            const matchedSchemes = Object.keys(authenticated);
            if (matchedSchemes.length === 1) {
                context.user = authenticated[matchedSchemes[0]].user;
            }
        }
    });
}
function setDefaultContentType(res) {
    const body = res.body;
    if (res.headers['content-type']) {
        // Nothing to do!
    }
    else if (body === undefined || body === null) {
        // Do nothing
    }
    else if (body instanceof Buffer) {
        res.headers['content-type'] = 'text/plain';
    }
    else if (typeof body === 'string') {
        res.headers['content-type'] = 'text/plain';
    }
    else if (typeUtils_1.isReadable(body)) {
        res.headers['content-type'] = 'text/plain';
    }
    else {
        res.headers['content-type'] = 'application/json';
    }
}
function resultToHttpResponse(context, result) {
    let output;
    const headers = context.res.headers;
    if (result) {
        if (result instanceof Buffer) {
            output = bufferToStream_1.default(result);
        }
        else if (typeof result === 'string') {
            output = stringToStream_1.default(result);
        }
        else if (typeUtils_1.isReadable(result)) {
            output = result;
        }
        else {
            if (!headers['content-type']) {
                headers['content-type'] = 'application/json';
            }
            output = stringToStream_1.default(JSON.stringify(result), 'utf-8');
        }
    }
    return {
        status: context.res.statusCode,
        headers,
        body: output
    };
}
function handleError(err) {
    if (err instanceof errors_1.ValidationError) {
        // TODO: Allow customization of validation error?  Or even
        // just throw the error instead of turning it into a message?
        const jsonError = {
            message: "Validation errors",
            errors: err.errors.map((error) => {
                return {
                    message: error.message,
                    location: error.location,
                };
            })
        };
        return {
            status: err.status,
            headers: { "content-type": "application/json" },
            body: stringToStream_1.default(JSON.stringify(jsonError), 'utf-8')
        };
    }
    else if (Number.isInteger(err.status)) {
        return {
            status: err.status,
            headers: { "content-type": "application/json" },
            body: stringToStream_1.default(JSON.stringify({ message: err.message }), 'utf-8')
        };
    }
    else {
        throw err;
    }
}
/**
 * Returns a `(req, res) => Promise<boolean>` function, which handles incoming
 * HTTP requests.  The returned function will return true if the request was
 * handled, and false otherwise.
 *
 * @returns runner function.
 */
function generateExegesisRunner(api, options) {
    return __awaiter(this, void 0, void 0, function* () {
        const plugins = options.plugins;
        return function exegesisRunner(req, res, ctx) {
            return __awaiter(this, void 0, void 0, function* () {
                const method = req.method || 'get';
                const url = req.url || '/';
                let result;
                try {
                    const resolved = api.resolve(method, url, req.headers);
                    if (!resolved) {
                        return result;
                    }
                    const context = new ExegesisContextImpl_1.default(req, res, resolved.api, options.originalOptions, ctx);
                    if (!context.isResponseFinished()) {
                        yield plugins.postRouting(context);
                    }
                    if (resolved.operation) {
                        const { operation } = resolved;
                        context._setOperation(operation);
                        if (!operation.controllerModule || !operation.controller) {
                            throw new Error(`No controller found for ${method} ${url}`);
                        }
                        yield handleSecurity(operation, context);
                        if (!context.isResponseFinished()) {
                            yield plugins.postSecurity(context);
                        }
                        if (!context.isResponseFinished()) {
                            // Fill in context.params and context.requestBody.
                            yield context.getParams();
                            yield context.getRequestBody();
                        }
                        if (!context.isResponseFinished()) {
                            yield invoke_1.invokeController(operation.controllerModule, operation.controller, context);
                        }
                        if (!context.origRes.headersSent) {
                            // Set _afterController to allow postController() plugins to
                            // modify the response.
                            context.res._afterController = true;
                            yield plugins.postController(context);
                        }
                        if (!context.origRes.headersSent) {
                            // Before response validation, if there is a body and no
                            // content-type has been set, set a reasonable default.
                            setDefaultContentType(context.res);
                            if (options.onResponseValidationError) {
                                const responseValidationResult = resolved.operation.validateResponse(context.res, options.validateDefaultResponses);
                                try {
                                    if (responseValidationResult.errors && responseValidationResult.errors.length) {
                                        options.onResponseValidationError({
                                            errors: responseValidationResult.errors,
                                            isDefault: responseValidationResult.isDefault,
                                            context
                                        });
                                    }
                                }
                                catch (err) {
                                    err.status = err.status || 500;
                                    throw err;
                                }
                            }
                        }
                        if (!context.origRes.headersSent) {
                            result = resultToHttpResponse(context, context.res.body);
                        }
                    }
                    return result;
                }
                catch (err) {
                    if (options.autoHandleHttpErrors) {
                        if (options.autoHandleHttpErrors instanceof Function) {
                            return options.autoHandleHttpErrors(err);
                        }
                        return handleError(err);
                    }
                    else {
                        throw err;
                    }
                }
            });
        };
    });
}
exports.default = generateExegesisRunner;
//# sourceMappingURL=exegesisRunner.js.map