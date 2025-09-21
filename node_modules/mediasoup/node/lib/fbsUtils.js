"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseVector = parseVector;
exports.parseStringStringVector = parseStringStringVector;
exports.parseStringUint8Vector = parseStringUint8Vector;
exports.parseUint16StringVector = parseUint16StringVector;
exports.parseUint32StringVector = parseUint32StringVector;
exports.parseStringStringArrayVector = parseStringStringArrayVector;
/**
 * Parse flatbuffers vector into an array of the given T.
 */
function parseVector(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
binary, methodName, 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
parseFn) {
    const array = [];
    for (let i = 0; i < binary[`${methodName}Length`](); ++i) {
        if (parseFn) {
            array.push(parseFn(binary[methodName](i)));
        }
        else {
            array.push(binary[methodName](i));
        }
    }
    return array;
}
/**
 * Parse flatbuffers vector of StringString into the corresponding array.
 */
function parseStringStringVector(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
binary, methodName) {
    const array = [];
    for (let i = 0; i < binary[`${methodName}Length`](); ++i) {
        const kv = binary[methodName](i);
        array.push({ key: kv.key(), value: kv.value() });
    }
    return array;
}
/**
 * Parse flatbuffers vector of StringUint8 into the corresponding array.
 */
function parseStringUint8Vector(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
binary, methodName) {
    const array = [];
    for (let i = 0; i < binary[`${methodName}Length`](); ++i) {
        const kv = binary[methodName](i);
        array.push({ key: kv.key(), value: kv.value() });
    }
    return array;
}
/**
 * Parse flatbuffers vector of Uint16String into the corresponding array.
 */
function parseUint16StringVector(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
binary, methodName) {
    const array = [];
    for (let i = 0; i < binary[`${methodName}Length`](); ++i) {
        const kv = binary[methodName](i);
        array.push({ key: kv.key(), value: kv.value() });
    }
    return array;
}
/**
 * Parse flatbuffers vector of Uint32String into the corresponding array.
 */
function parseUint32StringVector(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
binary, methodName) {
    const array = [];
    for (let i = 0; i < binary[`${methodName}Length`](); ++i) {
        const kv = binary[methodName](i);
        array.push({ key: kv.key(), value: kv.value() });
    }
    return array;
}
/**
 * Parse flatbuffers vector of StringStringArray into the corresponding array.
 */
function parseStringStringArrayVector(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
binary, methodName) {
    const array = [];
    for (let i = 0; i < binary[`${methodName}Length`](); ++i) {
        const kv = binary[methodName](i);
        const values = [];
        for (let i2 = 0; i2 < kv.valuesLength(); ++i2) {
            values.push(kv.values(i2));
        }
        array.push({ key: kv.key(), values });
    }
    return array;
}
