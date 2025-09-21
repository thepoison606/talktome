"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clone = clone;
exports.generateUUIDv4 = generateUUIDv4;
exports.generateRandomNumber = generateRandomNumber;
exports.deepFreeze = deepFreeze;
const node_crypto_1 = require("node:crypto");
/**
 * Clones the given value.
 */
function clone(value) {
    if (value === undefined) {
        return undefined;
    }
    else if (Number.isNaN(value)) {
        return NaN;
    }
    else if (typeof structuredClone === 'function') {
        // Available in Node >= 18.
        return structuredClone(value);
    }
    else {
        return JSON.parse(JSON.stringify(value));
    }
}
/**
 * Generates a random UUID v4.
 */
function generateUUIDv4() {
    return (0, node_crypto_1.randomUUID)();
}
/**
 * Generates a random positive integer.
 */
function generateRandomNumber() {
    return (0, node_crypto_1.randomInt)(100_000_000, 999_999_999);
}
/**
 * Make an object or array recursively immutable.
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/freeze.
 */
function deepFreeze(data) {
    // Retrieve the property names defined on object.
    const propNames = Reflect.ownKeys(data);
    // Freeze properties before freezing self.
    for (const name of propNames) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const value = data[name];
        if ((value && typeof value === 'object') || typeof value === 'function') {
            deepFreeze(value);
        }
    }
    return Object.freeze(data);
}
