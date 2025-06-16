"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseSctpParametersDump = parseSctpParametersDump;
exports.serializeSctpStreamParameters = serializeSctpStreamParameters;
exports.parseSctpStreamParameters = parseSctpStreamParameters;
const FbsSctpParameters = require("./fbs/sctp-parameters");
function parseSctpParametersDump(binary) {
    return {
        port: binary.port(),
        OS: binary.os(),
        MIS: binary.mis(),
        maxMessageSize: binary.maxMessageSize(),
        sendBufferSize: binary.sendBufferSize(),
        sctpBufferedAmount: binary.sctpBufferedAmount(),
        isDataChannel: binary.isDataChannel(),
    };
}
function serializeSctpStreamParameters(builder, parameters) {
    return FbsSctpParameters.SctpStreamParameters.createSctpStreamParameters(builder, parameters.streamId, parameters.ordered, typeof parameters.maxPacketLifeTime === 'number'
        ? parameters.maxPacketLifeTime
        : null, typeof parameters.maxRetransmits === 'number'
        ? parameters.maxRetransmits
        : null);
}
function parseSctpStreamParameters(parameters) {
    return {
        streamId: parameters.streamId(),
        ordered: parameters.ordered(),
        maxPacketLifeTime: parameters.maxPacketLifeTime() !== null
            ? parameters.maxPacketLifeTime()
            : undefined,
        maxRetransmits: parameters.maxRetransmits() !== null
            ? parameters.maxRetransmits()
            : undefined,
    };
}
