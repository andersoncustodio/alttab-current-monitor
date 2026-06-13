export class Patcher {
    constructor() {
        this._patches = [];
    }

    patch(proto, method, makeReplacement) {
        const original = proto[method];
        proto[method] = makeReplacement(original);
        this._patches.push({proto, method, original});
    }

    restoreAll() {
        while (this._patches.length) {
            const {proto, method, original} = this._patches.pop();
            proto[method] = original;
        }
    }
}
