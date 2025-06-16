"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DirectTransportImpl = void 0;
exports.parseDirectTransportDumpResponse = parseDirectTransportDumpResponse;
const Logger_1 = require("./Logger");
const enhancedEvents_1 = require("./enhancedEvents");
const Transport_1 = require("./Transport");
const errors_1 = require("./errors");
const notification_1 = require("./fbs/notification");
const FbsDirectTransport = require("./fbs/direct-transport");
const FbsTransport = require("./fbs/transport");
const FbsNotification = require("./fbs/notification");
const FbsRequest = require("./fbs/request");
const logger = new Logger_1.Logger('DirectTransport');
class DirectTransportImpl extends Transport_1.TransportImpl {
    // DirectTransport data.
    // eslint-disable-next-line no-unused-private-class-members
    #data;
    constructor(options) {
        const observer = new enhancedEvents_1.EnhancedEventEmitter();
        super(options, observer);
        logger.debug('constructor()');
        this.#data = {
        // Nothing.
        };
        this.handleWorkerNotifications();
        this.handleListenerError();
    }
    get type() {
        return 'direct';
    }
    get observer() {
        return super.observer;
    }
    close() {
        if (this.closed) {
            return;
        }
        super.close();
    }
    routerClosed() {
        if (this.closed) {
            return;
        }
        super.routerClosed();
    }
    async dump() {
        logger.debug('dump()');
        const response = await this.channel.request(FbsRequest.Method.TRANSPORT_DUMP, undefined, undefined, this.internal.transportId);
        /* Decode Response. */
        const data = new FbsDirectTransport.DumpResponse();
        response.body(data);
        return parseDirectTransportDumpResponse(data);
    }
    async getStats() {
        logger.debug('getStats()');
        const response = await this.channel.request(FbsRequest.Method.TRANSPORT_GET_STATS, undefined, undefined, this.internal.transportId);
        /* Decode Response. */
        const data = new FbsDirectTransport.GetStatsResponse();
        response.body(data);
        return [parseGetStatsResponse(data)];
    }
    // eslint-disable-next-line @typescript-eslint/require-await
    async connect() {
        logger.debug('connect()');
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await
    async setMaxIncomingBitrate(bitrate) {
        throw new errors_1.UnsupportedError('setMaxIncomingBitrate() not implemented in DirectTransport');
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await
    async setMaxOutgoingBitrate(bitrate) {
        throw new errors_1.UnsupportedError('setMaxOutgoingBitrate() not implemented in DirectTransport');
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await
    async setMinOutgoingBitrate(bitrate) {
        throw new errors_1.UnsupportedError('setMinOutgoingBitrate() not implemented in DirectTransport');
    }
    sendRtcp(rtcpPacket) {
        if (!Buffer.isBuffer(rtcpPacket)) {
            throw new TypeError('rtcpPacket must be a Buffer');
        }
        const builder = this.channel.bufferBuilder;
        const dataOffset = FbsTransport.SendRtcpNotification.createDataVector(builder, rtcpPacket);
        const notificationOffset = FbsTransport.SendRtcpNotification.createSendRtcpNotification(builder, dataOffset);
        this.channel.notify(FbsNotification.Event.TRANSPORT_SEND_RTCP, FbsNotification.Body.Transport_SendRtcpNotification, notificationOffset, this.internal.transportId);
    }
    handleWorkerNotifications() {
        this.channel.on(this.internal.transportId, (event, data) => {
            switch (event) {
                case notification_1.Event.TRANSPORT_TRACE: {
                    const notification = new FbsTransport.TraceNotification();
                    data.body(notification);
                    const trace = (0, Transport_1.parseTransportTraceEventData)(notification);
                    this.safeEmit('trace', trace);
                    // Emit observer event.
                    this.observer.safeEmit('trace', trace);
                    break;
                }
                case notification_1.Event.DIRECTTRANSPORT_RTCP: {
                    if (this.closed) {
                        break;
                    }
                    const notification = new FbsDirectTransport.RtcpNotification();
                    data.body(notification);
                    this.safeEmit('rtcp', Buffer.from(notification.dataArray()));
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
exports.DirectTransportImpl = DirectTransportImpl;
function parseDirectTransportDumpResponse(binary) {
    return (0, Transport_1.parseBaseTransportDump)(binary.base());
}
function parseGetStatsResponse(binary) {
    const base = (0, Transport_1.parseBaseTransportStats)(binary.base());
    return {
        ...base,
        type: 'direct-transport',
    };
}
