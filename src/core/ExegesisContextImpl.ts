import * as http from 'http';
import pb from 'promise-breaker';
import deepFreeze from 'deep-freeze';
import { Context as KoaContext } from 'koa';
import {
    ParametersByLocation,
    ParametersMap,
    ExegesisContext,
    AuthenticationSuccess,
    HttpIncomingMessage,
    ExegesisPluginContext,
    Callback,
    ParameterLocations,
    ParameterLocation,
    ExegesisOptions,
    ResolvedOperation,
    ExegesisRoute,
} from '../types';
import ExegesisResponseImpl from './ExegesisResponseImpl';
import { HttpError, ValidationError } from '../errors';

const EMPTY_PARAMS = deepFreeze({
    query: Object.create(null),
    header: Object.create(null),
    server: Object.create(null),
    path: Object.create(null),
    cookie: Object.create(null),
});

const EMPTY_PARAM_LOCATIONS: ParameterLocations = deepFreeze<ParameterLocations>({
    query: Object.create(null),
    header: Object.create(null),
    path: Object.create(null),
    cookie: Object.create(null),
});

const EMPTY_ROUTE = deepFreeze({
    path: '',
});

export default class ExegesisContextImpl<T> implements ExegesisContext, ExegesisPluginContext {
    readonly req: HttpIncomingMessage;
    readonly origRes: http.ServerResponse;
    readonly res: ExegesisResponseImpl;
    readonly options: ExegesisOptions;
    readonly koa: KoaContext;
    params: ParametersByLocation<ParametersMap<any>>;
    requestBody: any;
    security?: { [scheme: string]: AuthenticationSuccess };
    user: any | undefined;
    api: T;
    parameterLocations: ParameterLocations = EMPTY_PARAM_LOCATIONS;
    route: ExegesisRoute = EMPTY_ROUTE;
    baseUrl: string = '';

    private _operation: ResolvedOperation | undefined;
    private _paramsResolved: boolean = false;
    private _bodyResolved: boolean = false;

    constructor(
        req: http.IncomingMessage, // http2.Http2ServerRequest,
        res: http.ServerResponse, // http2.Http2ServerResponse,
        api: T,
        options: ExegesisOptions,
        ctx: KoaContext
    ) {
        const responseValidationEnabled = !!options.onResponseValidationError;
        this.req = req as HttpIncomingMessage;
        this.origRes = res;
        this.res = new ExegesisResponseImpl(res, responseValidationEnabled);
        this.api = api;
        this.options = options;
        this.koa = ctx;

        // Temporarily set params to EMPTY_PARAMS.  While we're being a
        // 'plugin context', this will be empty, but it will be filled in
        // before we get to the controllers.
        this.params = EMPTY_PARAMS;
    }

    _setOperation(baseUrl: string, path: string, operation: ResolvedOperation) {
        this.baseUrl = baseUrl;
        this.route = { path };
        this._operation = operation;
        this.parameterLocations = operation.parameterLocations;

        // Set `req.baseUrl` and `req.path` to make this behave like Express.
        const req = this.req as any;
        if (req.baseUrl) {
            req.baseUrl = `${req.baseUrl}${baseUrl}`;
        } else {
            req.baseUrl = baseUrl;
        }
        req.route = { path };
    }

    makeError(statusCode: number, message: string): HttpError {
        return new HttpError(statusCode, message);
    }

    makeValidationError(message: string, parameterLocation: ParameterLocation) {
        return new ValidationError([{ message, location: parameterLocation }]);
    }

    /**
     * Returns true if the response has already been sent.
     */
    isResponseFinished() {
        return this.res.ended || this.origRes.headersSent;
    }

    getParams(): Promise<ParametersByLocation<ParametersMap<any>>>;
    getParams(done: Callback<ParametersByLocation<ParametersMap<any>>>): void;
    getParams(done?: Callback<any>): Promise<ParametersByLocation<ParametersMap<any>>> | void {
        return pb.addCallback(done, () => {
            if (!this._paramsResolved) {
                if (!this._operation) {
                    throw new Error('Cannot get parameters - no resolved operation.');
                }
                this.params = this._operation.parseParameters();
                const errors = this._operation.validateParameters(this.params);
                if (errors && errors.length > 0) {
                    const err = new ValidationError(errors);
                    throw err;
                }
                this._paramsResolved = true;
            }
            return this.params;
        });
    }

    getRequestBody(): Promise<any>;
    getRequestBody(done: Callback<any>): void;
    getRequestBody(done?: Callback<any>): Promise<any> | void {
        return pb.addCallback(done, async () => {
            if (!this._operation) {
                throw new Error('Cannot get parameters - no resolved operation.');
            }

            if (!this._bodyResolved) {
                let body: any;

                // Parse the body.
                if (this._operation.bodyParser) {
                    const bodyParser = this._operation.bodyParser;
                    body = await pb.call((done: Callback<void>) =>
                        bodyParser.parseReq(this.req, this.origRes, done)
                    );
                    body = body || this.req.body;
                }
                // Validate the body.  We need to validate the body even if we
                // didn't parse a body, since this is where we check if the
                // body is required.
                if (this._operation.validateBody) {
                    const validationResult = this._operation.validateBody(body);
                    if (validationResult.errors && validationResult.errors.length > 0) {
                        throw new ValidationError(validationResult.errors);
                    }

                    body = validationResult.value;
                }

                // Assign the body to the appropriate places
                this.requestBody = this.req.body = body;
                this._bodyResolved = true;
            }
            return this.requestBody;
        });
    }
}
