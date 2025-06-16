"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RtpObserverImpl = void 0;
const Logger_1 = require("./Logger");
const enhancedEvents_1 = require("./enhancedEvents");
const FbsRequest = require("./fbs/request");
const FbsRouter = require("./fbs/router");
const FbsRtpObserver = require("./fbs/rtp-observer");
const logger = new Logger_1.Logger('RtpObserver');
class RtpObserverImpl extends enhancedEvents_1.EnhancedEventEmitter {
    // Internal data.
    internal;
    // Channel instance.
    channel;
    // Closed flag.
    #closed = false;
    // Paused flag.
    #paused = false;
    // Custom app data.
    #appData;
    // Method to retrieve a Producer.
    getProducerById;
    // Observer instance.
    #observer;
    constructor({ internal, channel, appData, getProducerById, }, observer) {
        super();
        logger.debug('constructor()');
        this.internal = internal;
        this.channel = channel;
        this.#appData = appData ?? {};
        this.getProducerById = getProducerById;
        this.#observer = observer;
    }
    get id() {
        return this.internal.rtpObserverId;
    }
    get closed() {
        return this.#closed;
    }
    get paused() {
        return this.#paused;
    }
    get appData() {
        return this.#appData;
    }
    set appData(appData) {
        this.#appData = appData;
    }
    get observer() {
        return this.#observer;
    }
    close() {
        if (this.#closed) {
            return;
        }
        logger.debug('close()');
        this.#closed = true;
        // Remove notification subscriptions.
        this.channel.removeAllListeners(this.internal.rtpObserverId);
        /* Build Request. */
        const requestOffset = new FbsRouter.CloseRtpObserverRequestT(this.internal.rtpObserverId).pack(this.channel.bufferBuilder);
        this.channel
            .request(FbsRequest.Method.ROUTER_CLOSE_RTPOBSERVER, FbsRequest.Body.Router_CloseRtpObserverRequest, requestOffset, this.internal.routerId)
            .catch(() => { });
        this.emit('@close');
        // Emit observer event.
        this.#observer.safeEmit('close');
    }
    routerClosed() {
        if (this.#closed) {
            return;
        }
        logger.debug('routerClosed()');
        this.#closed = true;
        // Remove notification subscriptions.
        this.channel.removeAllListeners(this.internal.rtpObserverId);
        this.safeEmit('routerclose');
        // Emit observer event.
        this.#observer.safeEmit('close');
    }
    async pause() {
        logger.debug('pause()');
        const wasPaused = this.#paused;
        await this.channel.request(FbsRequest.Method.RTPOBSERVER_PAUSE, undefined, undefined, this.internal.rtpObserverId);
        this.#paused = true;
        // Emit observer event.
        if (!wasPaused) {
            this.#observer.safeEmit('pause');
        }
    }
    async resume() {
        logger.debug('resume()');
        const wasPaused = this.#paused;
        await this.channel.request(FbsRequest.Method.RTPOBSERVER_RESUME, undefined, undefined, this.internal.rtpObserverId);
        this.#paused = false;
        // Emit observer event.
        if (wasPaused) {
            this.#observer.safeEmit('resume');
        }
    }
    async addProducer({ producerId }) {
        logger.debug('addProducer()');
        const producer = this.getProducerById(producerId);
        if (!producer) {
            throw Error(`Producer with id "${producerId}" not found`);
        }
        const requestOffset = new FbsRtpObserver.AddProducerRequestT(producerId).pack(this.channel.bufferBuilder);
        await this.channel.request(FbsRequest.Method.RTPOBSERVER_ADD_PRODUCER, FbsRequest.Body.RtpObserver_AddProducerRequest, requestOffset, this.internal.rtpObserverId);
        // Emit observer event.
        this.#observer.safeEmit('addproducer', producer);
    }
    async removeProducer({ producerId }) {
        logger.debug('removeProducer()');
        const producer = this.getProducerById(producerId);
        if (!producer) {
            throw Error(`Producer with id "${producerId}" not found`);
        }
        const requestOffset = new FbsRtpObserver.RemoveProducerRequestT(producerId).pack(this.channel.bufferBuilder);
        await this.channel.request(FbsRequest.Method.RTPOBSERVER_REMOVE_PRODUCER, FbsRequest.Body.RtpObserver_RemoveProducerRequest, requestOffset, this.internal.rtpObserverId);
        // Emit observer event.
        this.#observer.safeEmit('removeproducer', producer);
    }
}
exports.RtpObserverImpl = RtpObserverImpl;
