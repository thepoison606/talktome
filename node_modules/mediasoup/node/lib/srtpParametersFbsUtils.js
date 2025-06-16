"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cryptoSuiteFromFbs = cryptoSuiteFromFbs;
exports.cryptoSuiteToFbs = cryptoSuiteToFbs;
exports.parseSrtpParameters = parseSrtpParameters;
exports.serializeSrtpParameters = serializeSrtpParameters;
const FbsSrtpParameters = require("./fbs/srtp-parameters");
function cryptoSuiteFromFbs(binary) {
    switch (binary) {
        case FbsSrtpParameters.SrtpCryptoSuite.AEAD_AES_256_GCM: {
            return 'AEAD_AES_256_GCM';
        }
        case FbsSrtpParameters.SrtpCryptoSuite.AEAD_AES_128_GCM: {
            return 'AEAD_AES_128_GCM';
        }
        case FbsSrtpParameters.SrtpCryptoSuite.AES_CM_128_HMAC_SHA1_80: {
            return 'AES_CM_128_HMAC_SHA1_80';
        }
        case FbsSrtpParameters.SrtpCryptoSuite.AES_CM_128_HMAC_SHA1_32: {
            return 'AES_CM_128_HMAC_SHA1_32';
        }
    }
}
function cryptoSuiteToFbs(cryptoSuite) {
    switch (cryptoSuite) {
        case 'AEAD_AES_256_GCM': {
            return FbsSrtpParameters.SrtpCryptoSuite.AEAD_AES_256_GCM;
        }
        case 'AEAD_AES_128_GCM': {
            return FbsSrtpParameters.SrtpCryptoSuite.AEAD_AES_128_GCM;
        }
        case 'AES_CM_128_HMAC_SHA1_80': {
            return FbsSrtpParameters.SrtpCryptoSuite.AES_CM_128_HMAC_SHA1_80;
        }
        case 'AES_CM_128_HMAC_SHA1_32': {
            return FbsSrtpParameters.SrtpCryptoSuite.AES_CM_128_HMAC_SHA1_32;
        }
        default: {
            throw new TypeError(`invalid SrtpCryptoSuite: ${cryptoSuite}`);
        }
    }
}
function parseSrtpParameters(binary) {
    return {
        cryptoSuite: cryptoSuiteFromFbs(binary.cryptoSuite()),
        keyBase64: binary.keyBase64(),
    };
}
function serializeSrtpParameters(builder, srtpParameters) {
    const keyBase64Offset = builder.createString(srtpParameters.keyBase64);
    return FbsSrtpParameters.SrtpParameters.createSrtpParameters(builder, cryptoSuiteToFbs(srtpParameters.cryptoSuite), keyBase64Offset);
}
