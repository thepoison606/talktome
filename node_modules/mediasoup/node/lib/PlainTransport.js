"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlainTransportImpl = void 0;
exports.parsePlainTransportDumpResponse = parsePlainTransportDumpResponse;
const Logger_1 = require("./Logger");
const enhancedEvents_1 = require("./enhancedEvents");
const Transport_1 = require("./Transport");
const srtpParametersFbsUtils_1 = require("./srtpParametersFbsUtils");
const notification_1 = require("./fbs/notification");
const FbsRequest = require("./fbs/request");
const FbsTransport = require("./fbs/transport");
const FbsPlainTransport = require("./fbs/plain-transport");
const logger = new Logger_1.Logger('PlainTransport');
class PlainTransportImpl extends Transport_1.TransportImpl {
    // PlainTransport data.
    #data;
    constructor(options) {
        const observer = new enhancedEvents_1.EnhancedEventEmitter();
        super(options, observer);
        logger.debug('constructor()');
        const { data } = options;
        this.#data = {
            rtcpMux: data.rtcpMux,
            comedia: data.comedia,
            tuple: data.tuple,
            rtcpTuple: data.rtcpTuple,
            sctpParameters: data.sctpParameters,
            sctpState: data.sctpState,
            srtpParameters: data.srtpParameters,
        };
        this.handleWorkerNotifications();
        this.handleListenerError();
    }
    get type() {
        return 'plain';
    }
    get observer() {
        return super.observer;
    }
    get tuple() {
        return this.#data.tuple;
    }
    get rtcpTuple() {
        return this.#data.rtcpTuple;
    }
    get sctpParameters() {
        return this.#data.sctpParameters;
    }
    get sctpState() {
        return this.#data.sctpState;
    }
    get srtpParameters() {
        return this.#data.srtpParameters;
    }
    close() {
        if (this.closed) {
            return;
        }
        if (this.#data.sctpState) {
            this.#data.sctpState = 'closed';
        }
        super.close();
    }
    routerClosed() {
        if (this.closed) {
            return;
        }
        if (this.#data.sctpState) {
            this.#data.sctpState = 'closed';
        }
        super.routerClosed();
    }
    async dump() {
        logger.debug('dump()');
        const response = await this.channel.request(FbsRequest.Method.TRANSPORT_DUMP, undefined, undefined, this.internal.transportId);
        /* Decode Response. */
        const data = new FbsPlainTransport.DumpResponse();
        response.body(data);
        return parsePlainTransportDumpResponse(data);
    }
    async getStats() {
        logger.debug('getStats()');
        const response = await this.channel.request(FbsRequest.Method.TRANSPORT_GET_STATS, undefined, undefined, this.internal.transportId);
        /* Decode Response. */
        const data = new FbsPlainTransport.GetStatsResponse();
        response.body(data);
        return [parseGetStatsResponse(data)];
    }
    async connect({ ip, port, rtcpPort, srtpParameters, }) {
        logger.debug('connect()');
        const requestOffset = createConnectRequest({
            builder: this.channel.bufferBuilder,
            ip,
            port,
            rtcpPort,
            srtpParameters,
        });
        // Wait for response.
        const response = await this.channel.request(FbsRequest.Method.PLAINTRANSPORT_CONNECT, FbsRequest.Body.PlainTransport_ConnectRequest, requestOffset, this.internal.transportId);
        /* Decode Response. */
        const data = new FbsPlainTransport.ConnectResponse();
        response.body(data);
        // Update data.
        if (data.tuple()) {
            this.#data.tuple = (0, Transport_1.parseTuple)(data.tuple());
        }
        if (data.rtcpTuple()) {
            this.#data.rtcpTuple = (0, Transport_1.parseTuple)(data.rtcpTuple());
        }
        if (data.srtpParameters()) {
            this.#data.srtpParameters = (0, srtpParametersFbsUtils_1.parseSrtpParameters)(data.srtpParameters());
        }
    }
    handleWorkerNotifications() {
        this.channel.on(this.internal.transportId, (event, data) => {
            switch (event) {
                case notification_1.Event.PLAINTRANSPORT_TUPLE: {
                    const notification = new FbsPlainTransport.TupleNotification();
                    data.body(notification);
                    const tuple = (0, Transport_1.parseTuple)(notification.tuple());
                    this.#data.tuple = tuple;
                    this.safeEmit('tuple', tuple);
                    // Emit observer event.
                    this.observer.safeEmit('tuple', tuple);
                    break;
                }
                case notification_1.Event.PLAINTRANSPORT_RTCP_TUPLE: {
                    const notification = new FbsPlainTransport.RtcpTupleNotification();
                    data.body(notification);
                    const rtcpTuple = (0, Transport_1.parseTuple)(notification.tuple());
                    this.#data.rtcpTuple = rtcpTuple;
                    this.safeEmit('rtcptuple', rtcpTuple);
                    // Emit observer event.
                    this.observer.safeEmit('rtcptuple', rtcpTuple);
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
exports.PlainTransportImpl = PlainTransportImpl;
function parsePlainTransportDumpResponse(binary) {
    // Retrieve BaseTransportDump.
    const baseTransportDump = (0, Transport_1.parseBaseTransportDump)(binary.base());
    // Retrieve RTP Tuple.
    const tuple = (0, Transport_1.parseTuple)(binary.tuple());
    // Retrieve RTCP Tuple.
    let rtcpTuple;
    if (binary.rtcpTuple()) {
        rtcpTuple = (0, Transport_1.parseTuple)(binary.rtcpTuple());
    }
    // Retrieve SRTP Parameters.
    let srtpParameters;
    if (binary.srtpParameters()) {
        srtpParameters = (0, srtpParametersFbsUtils_1.parseSrtpParameters)(binary.srtpParameters());
    }
    return {
        ...baseTransportDump,
        rtcpMux: binary.rtcpMux(),
        comedia: binary.comedia(),
        tuple: tuple,
        rtcpTuple: rtcpTuple,
        srtpParameters: srtpParameters,
    };
}
function parseGetStatsResponse(binary) {
    const base = (0, Transport_1.parseBaseTransportStats)(binary.base());
    return {
        ...base,
        type: 'plain-rtp-transport',
        rtcpMux: binary.rtcpMux(),
        comedia: binary.comedia(),
        tuple: (0, Transport_1.parseTuple)(binary.tuple()),
        rtcpTuple: binary.rtcpTuple() ? (0, Transport_1.parseTuple)(binary.rtcpTuple()) : undefined,
    };
}
function createConnectRequest({ builder, ip, port, rtcpPort, srtpParameters, }) {
    let ipOffset = 0;
    let srtpParametersOffset = 0;
    if (ip) {
        ipOffset = builder.createString(ip);
    }
    // Serialize SrtpParameters.
    if (srtpParameters) {
        srtpParametersOffset = (0, srtpParametersFbsUtils_1.serializeSrtpParameters)(builder, srtpParameters);
    }
    // Create PlainTransportConnectData.
    FbsPlainTransport.ConnectRequest.startConnectRequest(builder);
    FbsPlainTransport.ConnectRequest.addIp(builder, ipOffset);
    if (typeof port === 'number') {
        FbsPlainTransport.ConnectRequest.addPort(builder, port);
    }
    if (typeof rtcpPort === 'number') {
        FbsPlainTransport.ConnectRequest.addRtcpPort(builder, rtcpPort);
    }
    if (srtpParameters) {
        FbsPlainTransport.ConnectRequest.addSrtpParameters(builder, srtpParametersOffset);
    }
    return FbsPlainTransport.ConnectRequest.endConnectRequest(builder);
}
