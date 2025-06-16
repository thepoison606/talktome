"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebRtcTransportImpl = void 0;
exports.parseWebRtcTransportDumpResponse = parseWebRtcTransportDumpResponse;
const Logger_1 = require("./Logger");
const enhancedEvents_1 = require("./enhancedEvents");
const Transport_1 = require("./Transport");
const fbsUtils = require("./fbsUtils");
const notification_1 = require("./fbs/notification");
const FbsRequest = require("./fbs/request");
const FbsTransport = require("./fbs/transport");
const FbsWebRtcTransport = require("./fbs/web-rtc-transport");
const dtls_state_1 = require("./fbs/web-rtc-transport/dtls-state");
const dtls_role_1 = require("./fbs/web-rtc-transport/dtls-role");
const fingerprint_algorithm_1 = require("./fbs/web-rtc-transport/fingerprint-algorithm");
const ice_state_1 = require("./fbs/web-rtc-transport/ice-state");
const ice_role_1 = require("./fbs/web-rtc-transport/ice-role");
const ice_candidate_type_1 = require("./fbs/web-rtc-transport/ice-candidate-type");
const ice_candidate_tcp_type_1 = require("./fbs/web-rtc-transport/ice-candidate-tcp-type");
const logger = new Logger_1.Logger('WebRtcTransport');
class WebRtcTransportImpl extends Transport_1.TransportImpl {
    // WebRtcTransport data.
    #data;
    constructor(options) {
        const observer = new enhancedEvents_1.EnhancedEventEmitter();
        super(options, observer);
        logger.debug('constructor()');
        const { data } = options;
        this.#data = {
            iceRole: data.iceRole,
            iceParameters: data.iceParameters,
            iceCandidates: data.iceCandidates,
            iceState: data.iceState,
            iceSelectedTuple: data.iceSelectedTuple,
            dtlsParameters: data.dtlsParameters,
            dtlsState: data.dtlsState,
            dtlsRemoteCert: data.dtlsRemoteCert,
            sctpParameters: data.sctpParameters,
            sctpState: data.sctpState,
        };
        this.handleWorkerNotifications();
        this.handleListenerError();
    }
    get type() {
        return 'webrtc';
    }
    get observer() {
        return super.observer;
    }
    get iceRole() {
        return this.#data.iceRole;
    }
    get iceParameters() {
        return this.#data.iceParameters;
    }
    get iceCandidates() {
        return this.#data.iceCandidates;
    }
    get iceState() {
        return this.#data.iceState;
    }
    get iceSelectedTuple() {
        return this.#data.iceSelectedTuple;
    }
    get dtlsParameters() {
        return this.#data.dtlsParameters;
    }
    get dtlsState() {
        return this.#data.dtlsState;
    }
    get dtlsRemoteCert() {
        return this.#data.dtlsRemoteCert;
    }
    get sctpParameters() {
        return this.#data.sctpParameters;
    }
    get sctpState() {
        return this.#data.sctpState;
    }
    close() {
        if (this.closed) {
            return;
        }
        this.#data.iceState = 'closed';
        this.#data.iceSelectedTuple = undefined;
        this.#data.dtlsState = 'closed';
        if (this.#data.sctpState) {
            this.#data.sctpState = 'closed';
        }
        super.close();
    }
    routerClosed() {
        if (this.closed) {
            return;
        }
        this.#data.iceState = 'closed';
        this.#data.iceSelectedTuple = undefined;
        this.#data.dtlsState = 'closed';
        if (this.#data.sctpState) {
            this.#data.sctpState = 'closed';
        }
        super.routerClosed();
    }
    listenServerClosed() {
        if (this.closed) {
            return;
        }
        this.#data.iceState = 'closed';
        this.#data.iceSelectedTuple = undefined;
        this.#data.dtlsState = 'closed';
        if (this.#data.sctpState) {
            this.#data.sctpState = 'closed';
        }
        super.listenServerClosed();
    }
    async dump() {
        logger.debug('dump()');
        const response = await this.channel.request(FbsRequest.Method.TRANSPORT_DUMP, undefined, undefined, this.internal.transportId);
        /* Decode Response. */
        const data = new FbsWebRtcTransport.DumpResponse();
        response.body(data);
        return parseWebRtcTransportDumpResponse(data);
    }
    async getStats() {
        logger.debug('getStats()');
        const response = await this.channel.request(FbsRequest.Method.TRANSPORT_GET_STATS, undefined, undefined, this.internal.transportId);
        /* Decode Response. */
        const data = new FbsWebRtcTransport.GetStatsResponse();
        response.body(data);
        return [parseGetStatsResponse(data)];
    }
    async connect({ dtlsParameters, }) {
        logger.debug('connect()');
        const requestOffset = createConnectRequest({
            builder: this.channel.bufferBuilder,
            dtlsParameters,
        });
        // Wait for response.
        const response = await this.channel.request(FbsRequest.Method.WEBRTCTRANSPORT_CONNECT, FbsRequest.Body.WebRtcTransport_ConnectRequest, requestOffset, this.internal.transportId);
        /* Decode Response. */
        const data = new FbsWebRtcTransport.ConnectResponse();
        response.body(data);
        // Update data.
        this.#data.dtlsParameters.role = dtlsRoleFromFbs(data.dtlsLocalRole());
    }
    async restartIce() {
        logger.debug('restartIce()');
        const response = await this.channel.request(FbsRequest.Method.TRANSPORT_RESTART_ICE, undefined, undefined, this.internal.transportId);
        /* Decode Response. */
        const restartIceResponse = new FbsTransport.RestartIceResponse();
        response.body(restartIceResponse);
        const iceParameters = {
            usernameFragment: restartIceResponse.usernameFragment(),
            password: restartIceResponse.password(),
            iceLite: restartIceResponse.iceLite(),
        };
        this.#data.iceParameters = iceParameters;
        return iceParameters;
    }
    handleWorkerNotifications() {
        this.channel.on(this.internal.transportId, (event, data) => {
            switch (event) {
                case notification_1.Event.WEBRTCTRANSPORT_ICE_STATE_CHANGE: {
                    const notification = new FbsWebRtcTransport.IceStateChangeNotification();
                    data.body(notification);
                    const iceState = iceStateFromFbs(notification.iceState());
                    this.#data.iceState = iceState;
                    this.safeEmit('icestatechange', iceState);
                    // Emit observer event.
                    this.observer.safeEmit('icestatechange', iceState);
                    break;
                }
                case notification_1.Event.WEBRTCTRANSPORT_ICE_SELECTED_TUPLE_CHANGE: {
                    const notification = new FbsWebRtcTransport.IceSelectedTupleChangeNotification();
                    data.body(notification);
                    const iceSelectedTuple = (0, Transport_1.parseTuple)(notification.tuple());
                    this.#data.iceSelectedTuple = iceSelectedTuple;
                    this.safeEmit('iceselectedtuplechange', iceSelectedTuple);
                    // Emit observer event.
                    this.observer.safeEmit('iceselectedtuplechange', iceSelectedTuple);
                    break;
                }
                case notification_1.Event.WEBRTCTRANSPORT_DTLS_STATE_CHANGE: {
                    const notification = new FbsWebRtcTransport.DtlsStateChangeNotification();
                    data.body(notification);
                    const dtlsState = dtlsStateFromFbs(notification.dtlsState());
                    this.#data.dtlsState = dtlsState;
                    if (dtlsState === 'connected') {
                        this.#data.dtlsRemoteCert = notification.remoteCert();
                    }
                    this.safeEmit('dtlsstatechange', dtlsState);
                    // Emit observer event.
                    this.observer.safeEmit('dtlsstatechange', dtlsState);
                    break;
                }
                case notification_1.Event.TRANSPORT_SCTP_STATE_CHANGE: {
                    const notification = new FbsTransport.SctpStateChangeNotification();
                    data.body(notification);
                    const sctpState = (0, Transport_1.parseSctpState)(notification.sctpState());
                    this.#data.sctpState = sctpState;
                    this.safeEmit('sctpstatechange', sctpState);
                    // Emit observer event.
                    this.observer.safeEmit('sctpstatechange', sctpState);
                    break;
                }
                case notification_1.Event.TRANSPORT_TRACE: {
                    const notification = new FbsTransport.TraceNotification();
                    data.body(notification);
                    const trace = (0, Transport_1.parseTransportTraceEventData)(notification);
                    this.safeEmit('trace', trace);
                    // Emit observer event.
                    this.observer.safeEmit('trace', trace);
                    break;
                }
                default: {
                    logger.error(`ignoring unknown event "${event}"`);
                }
            }
        });
    }
    handleListenerError() {
        this.on('listenererror', (eventName, error) => {
            logger.error(`event listener threw an error [eventName:${eventName}]:`, error);
        });
    }
}
exports.WebRtcTransportImpl = WebRtcTransportImpl;
function iceStateFromFbs(fbsIceState) {
    switch (fbsIceState) {
        case ice_state_1.IceState.NEW: {
            return 'new';
        }
        case ice_state_1.IceState.CONNECTED: {
            return 'connected';
        }
        case ice_state_1.IceState.COMPLETED: {
            return 'completed';
        }
        case ice_state_1.IceState.DISCONNECTED: {
            return 'disconnected';
        }
    }
}
function iceRoleFromFbs(role) {
    switch (role) {
        case ice_role_1.IceRole.CONTROLLED: {
            return 'controlled';
        }
        case ice_role_1.IceRole.CONTROLLING: {
            return 'controlling';
        }
    }
}
function iceCandidateTypeFromFbs(type) {
    switch (type) {
        case ice_candidate_type_1.IceCandidateType.HOST: {
            return 'host';
        }
    }
}
function iceCandidateTcpTypeFromFbs(type) {
    switch (type) {
        case ice_candidate_tcp_type_1.IceCandidateTcpType.PASSIVE: {
            return 'passive';
        }
    }
}
function dtlsStateFromFbs(fbsDtlsState) {
    switch (fbsDtlsState) {
        case dtls_state_1.DtlsState.NEW: {
            return 'new';
        }
        case dtls_state_1.DtlsState.CONNECTING: {
            return 'connecting';
        }
        case dtls_state_1.DtlsState.CONNECTED: {
            return 'connected';
        }
        case dtls_state_1.DtlsState.FAILED: {
            return 'failed';
        }
        case dtls_state_1.DtlsState.CLOSED: {
            return 'closed';
        }
    }
}
function dtlsRoleFromFbs(role) {
    switch (role) {
        case dtls_role_1.DtlsRole.AUTO: {
            return 'auto';
        }
        case dtls_role_1.DtlsRole.CLIENT: {
            return 'client';
        }
        case dtls_role_1.DtlsRole.SERVER: {
            return 'server';
        }
    }
}
function fingerprintAlgorithmsFromFbs(algorithm) {
    switch (algorithm) {
        case fingerprint_algorithm_1.FingerprintAlgorithm.SHA1: {
            return 'sha-1';
        }
        case fingerprint_algorithm_1.FingerprintAlgorithm.SHA224: {
            return 'sha-224';
        }
        case fingerprint_algorithm_1.FingerprintAlgorithm.SHA256: {
            return 'sha-256';
        }
        case fingerprint_algorithm_1.FingerprintAlgorithm.SHA384: {
            return 'sha-384';
        }
        case fingerprint_algorithm_1.FingerprintAlgorithm.SHA512: {
            return 'sha-512';
        }
    }
}
function fingerprintAlgorithmToFbs(algorithm) {
    switch (algorithm) {
        case 'sha-1': {
            return fingerprint_algorithm_1.FingerprintAlgorithm.SHA1;
        }
        case 'sha-224': {
            return fingerprint_algorithm_1.FingerprintAlgorithm.SHA224;
        }
        case 'sha-256': {
            return fingerprint_algorithm_1.FingerprintAlgorithm.SHA256;
        }
        case 'sha-384': {
            return fingerprint_algorithm_1.FingerprintAlgorithm.SHA384;
        }
        case 'sha-512': {
            return fingerprint_algorithm_1.FingerprintAlgorithm.SHA512;
        }
        default: {
            throw new TypeError(`invalid FingerprintAlgorithm: ${algorithm}`);
        }
    }
}
function dtlsRoleToFbs(role) {
    switch (role) {
        case 'auto': {
            return dtls_role_1.DtlsRole.AUTO;
        }
        case 'client': {
            return dtls_role_1.DtlsRole.CLIENT;
        }
        case 'server': {
            return dtls_role_1.DtlsRole.SERVER;
        }
        default: {
            throw new TypeError(`invalid DtlsRole: ${role}`);
        }
    }
}
function parseWebRtcTransportDumpResponse(binary) {
    // Retrieve BaseTransportDump.
    const baseTransportDump = (0, Transport_1.parseBaseTransportDump)(binary.base());
    // Retrieve ICE candidates.
    const iceCandidates = fbsUtils.parseVector(binary, 'iceCandidates', parseIceCandidate);
    // Retrieve ICE parameters.
    const iceParameters = parseIceParameters(binary.iceParameters());
    // Retrieve DTLS parameters.
    const dtlsParameters = parseDtlsParameters(binary.dtlsParameters());
    return {
        ...baseTransportDump,
        sctpParameters: baseTransportDump.sctpParameters,
        sctpState: baseTransportDump.sctpState,
        iceRole: 'controlled',
        iceParameters: iceParameters,
        iceCandidates: iceCandidates,
        iceState: iceStateFromFbs(binary.iceState()),
        dtlsParameters: dtlsParameters,
        dtlsState: dtlsStateFromFbs(binary.dtlsState()),
    };
}
function createConnectRequest({ builder, dtlsParameters, }) {
    // Serialize DtlsParameters. This can throw.
    const dtlsParametersOffset = serializeDtlsParameters(builder, dtlsParameters);
    return FbsWebRtcTransport.ConnectRequest.createConnectRequest(builder, dtlsParametersOffset);
}
function parseGetStatsResponse(binary) {
    const base = (0, Transport_1.parseBaseTransportStats)(binary.base());
    return {
        ...base,
        type: 'webrtc-transport',
        iceRole: iceRoleFromFbs(binary.iceRole()),
        iceState: iceStateFromFbs(binary.iceState()),
        iceSelectedTuple: binary.iceSelectedTuple()
            ? (0, Transport_1.parseTuple)(binary.iceSelectedTuple())
            : undefined,
        dtlsState: dtlsStateFromFbs(binary.dtlsState()),
    };
}
function parseIceCandidate(binary) {
    return {
        foundation: binary.foundation(),
        priority: binary.priority(),
        ip: binary.address(),
        address: binary.address(),
        protocol: (0, Transport_1.parseProtocol)(binary.protocol()),
        port: binary.port(),
        type: iceCandidateTypeFromFbs(binary.type()),
        tcpType: binary.tcpType() === null
            ? undefined
            : iceCandidateTcpTypeFromFbs(binary.tcpType()),
    };
}
function parseIceParameters(binary) {
    return {
        usernameFragment: binary.usernameFragment(),
        password: binary.password(),
        iceLite: binary.iceLite(),
    };
}
function parseDtlsParameters(binary) {
    const fingerprints = [];
    for (let i = 0; i < binary.fingerprintsLength(); ++i) {
        const fbsFingerprint = binary.fingerprints(i);
        const fingerPrint = {
            algorithm: fingerprintAlgorithmsFromFbs(fbsFingerprint.algorithm()),
            value: fbsFingerprint.value(),
        };
        fingerprints.push(fingerPrint);
    }
    return {
        fingerprints: fingerprints,
        role: binary.role() === null ? undefined : dtlsRoleFromFbs(binary.role()),
    };
}
function serializeDtlsParameters(builder, dtlsParameters) {
    const fingerprints = [];
    for (const fingerprint of dtlsParameters.fingerprints) {
        const algorithm = fingerprintAlgorithmToFbs(fingerprint.algorithm);
        const valueOffset = builder.createString(fingerprint.value);
        const fingerprintOffset = FbsWebRtcTransport.Fingerprint.createFingerprint(builder, algorithm, valueOffset);
        fingerprints.push(fingerprintOffset);
    }
    const fingerprintsOffset = FbsWebRtcTransport.DtlsParameters.createFingerprintsVector(builder, fingerprints);
    const role = dtlsParameters.role !== undefined
        ? dtlsRoleToFbs(dtlsParameters.role)
        : FbsWebRtcTransport.DtlsRole.AUTO;
    return FbsWebRtcTransport.DtlsParameters.createDtlsParameters(builder, fingerprintsOffset, role);
}
