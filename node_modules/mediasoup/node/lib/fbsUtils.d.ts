/**
 * Parse flatbuffers vector into an array of the given T.
 */
export declare function parseVector<T>(binary: any, methodName: string, parseFn?: (binary2: any) => T): T[];
/**
 * Parse flatbuffers vector of StringString into the corresponding array.
 */
export declare function parseStringStringVector(binary: any, methodName: string): {
    key: string;
    value: string;
}[];
/**
 * Parse flatbuffers vector of StringUint8 into the corresponding array.
 */
export declare function parseStringUint8Vector(binary: any, methodName: string): {
    key: string;
    value: number;
}[];
/**
 * Parse flatbuffers vector of Uint16String into the corresponding array.
 */
export declare function parseUint16StringVector(binary: any, methodName: string): {
    key: number;
    value: string;
}[];
/**
 * Parse flatbuffers vector of Uint32String into the corresponding array.
 */
export declare function parseUint32StringVector(binary: any, methodName: string): {
    key: number;
    value: string;
}[];
/**
 * Parse flatbuffers vector of StringStringArray into the corresponding array.
 */
export declare function parseStringStringArrayVector(binary: any, methodName: string): {
    key: string;
    values: string[];
}[];
//# sourceMappingURL=fbsUtils.d.ts.map