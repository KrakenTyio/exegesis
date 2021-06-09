"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function httpHasBody(headers) {
    const contentLength = headers['content-length'];
    return !!headers['transfer-encoding'] ||
        (contentLength && contentLength !== '0' && contentLength !== 0);
}
exports.default = httpHasBody;
//# sourceMappingURL=httpHasBody.js.map