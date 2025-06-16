"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Channel = void 0;
const os = require("node:os");
const node_console_1 = require("node:console");
const flatbuffers = require("flatbuffers");
const Logger_1 = require("./Logger");
const enhancedEvents_1 = require("./enhancedEvents");
const errors_1 = require("./errors");
const request_1 = require("./fbs/request");
const response_1 = require("./fbs/response");
const message_1 = require("./fbs/message");
const notification_1 = require("./fbs/notification");
const log_1 = require("./fbs/log");
const IS_LITTLE_ENDIAN = os.endianness() === 'LE';
const logger = new Logger_1.Logger('Channel');
// Binary length for a 4194304 bytes payload.
const MESSAGE_MAX_LEN = 4194308;
const PAYLOAD_MAX_LEN = 4194304;
class Channel extends enhancedEvents_1.EnhancedEventEmitter {
    // Closed flag.
    #closed = false;
    // Unix Socket instance for sending messages to the worker process.
    #producerSocket;
    // Unix Socket instance for receiving messages to the worker process.
    #consumerSocket;
    // Next id for messages sent to the worker process.
    #nextId = 0;
    // Map of pending sent requests.
    #sents = new Map();
    // Buffer for reading messages from the worker.
    #recvBuffer = Buffer.alloc(0);
    // flatbuffers builder.
    #bufferBuilder = new flatbuffers.Builder(1024);
    constructor({ producerSocket, consumerSocket, pid, }) {
        super();
        logger.debug('constructor()');
        this.#producerSocket = producerSocket;
        this.#consumerSocket = consumerSocket;
        // Read Channel responses/notifications from the worker.
        this.#consumerSocket.on('data', (buffer) => {
            if (!this.#recvBuffer.length) {
                this.#recvBuffer = buffer;
            }
            else {
                this.#recvBuffer = Buffer.concat([this.#recvBuffer, buffer], this.#recvBuffer.length + buffer.length);
            }
            if (this.#recvBuffer.length > PAYLOAD_MAX_LEN) {
                logger.error('receiving buffer is full, discarding all data in it');
                // Reset the buffer and exit.
                this.#recvBuffer = Buffer.alloc(0);
                return;
            }
            let msgStart = 0;
            while (true) {
                const readLen = this.#recvBuffer.length - msgStart;
                if (readLen < 4) {
                    // Incomplete data.
                    break;
                }
                const dataView = new DataView(this.#recvBuffer.buffer, this.#recvBuffer.byteOffset + msgStart);
                const msgLen = dataView.getUint32(0, IS_LITTLE_ENDIAN);
                if (readLen < 4 + msgLen) {
                    // Incomplete data.
                    break;
                }
                const payload = this.#recvBuffer.subarray(msgStart + 4, msgStart + 4 + msgLen);
                msgStart += 4 + msgLen;
                const buf = new flatbuffers.ByteBuffer(new Uint8Array(payload));
                const message = message_1.Message.getRootAsMessage(buf);
                try {
                    switch (message.dataType()) {
                        case message_1.Body.Response: {
                            const response = new response_1.Response();
                            message.data(response);
                            this.processResponse(response);
                            break;
                        }
                        case message_1.Body.Notification: {
                            const notification = new notification_1.Notification();
                            message.data(notification);
                            this.processNotification(notification);
                            break;
                        }
                        case message_1.Body.Log: {
                            const log = new log_1.Log();
                            message.data(log);
                            this.processLog(pid, log);
                            break;
                        }
                        default: {
                            (0, node_console_1.warn)(`worker[pid:${pid}] unexpected data: ${payload.toString('utf8', 1)}`);
                        }
                    }
                }
                catch (error) {
                    logger.error(`received invalid message from the worker process: ${error}`);
                }
            }
            if (msgStart != 0) {
                this.#recvBuffer = this.#recvBuffer.slice(msgStart);
            }
        });
        this.#consumerSocket.on('end', () => logger.debug('Consumer Channel ended by the worker process'));
        this.#consumerSocket.on('error', error => logger.error(`Consumer Channel error: ${error}`));
        this.#producerSocket.on('end', () => logger.debug('Producer Channel ended by the worker process'));
        this.#producerSocket.on('error', error => logger.error(`Producer Channel error: ${error}`));
    }
    /**
     * flatbuffer builder.
     */
    get bufferBuilder() {
        return this.#bufferBuilder;
    }
    close() {
        if (this.#closed) {
            return;
        }
        logger.debug('close()');
        this.#closed = true;
        // Close every pending sent.
        for (const sent of this.#sents.values()) {
            sent.close();
        }
        // Remove event listeners but leave a fake 'error' hander to avoid
        // propagation.
        this.#consumerSocket.removeAllListeners('end');
        this.#consumerSocket.removeAllListeners('error');
        this.#consumerSocket.on('error', () => { });
        this.#producerSocket.removeAllListeners('end');
        this.#producerSocket.removeAllListeners('error');
        this.#producerSocket.on('error', () => { });
        // Destroy the sockets.
        try {
            this.#producerSocket.destroy();
        }
        catch (error) { }
        try {
            this.#consumerSocket.destroy();
        }
        catch (error) { }
    }
    notify(event, bodyType, bodyOffset, handlerId) {
        logger.debug(`notify() [event:${notification_1.Event[event]}]`);
        if (this.#closed) {
            throw new errors_1.InvalidStateError(`Channel closed, cannot send notification [event:${notification_1.Event[event]}]`);
        }
        const handlerIdOffset = this.#bufferBuilder.createString(handlerId);
        let notificationOffset;
        if (bodyType && bodyOffset) {
            notificationOffset = notification_1.Notification.createNotification(this.#bufferBuilder, handlerIdOffset, event, bodyType, bodyOffset);
        }
        else {
            notificationOffset = notification_1.Notification.createNotification(this.#bufferBuilder, handlerIdOffset, event, notification_1.Body.NONE, 0);
        }
        const messageOffset = message_1.Message.createMessage(this.#bufferBuilder, message_1.Body.Notification, notificationOffset);
        // Finalizes the buffer and adds a 4 byte prefix with the size of the buffer.
        this.#bufferBuilder.finishSizePrefixed(messageOffset);
        // Create a new buffer with this data so multiple contiguous flatbuffers
        // do not point to the builder buffer overriding others info.
        const buffer = new Uint8Array(this.#bufferBuilder.asUint8Array());
        // Clear the buffer builder so it's reused for the next request.
        this.#bufferBuilder.clear();
        if (buffer.byteLength > MESSAGE_MAX_LEN) {
            throw new Error(`notification too big [event:${notification_1.Event[event]}]`);
        }
        try {
            // This may throw if closed or remote side ended.
            this.#producerSocket.write(buffer, 'binary');
        }
        catch (error) {
            logger.warn(`notify() | sending notification failed: ${error}`);
            return;
        }
    }
    async request(method, bodyType, bodyOffset, handlerId) {
        logger.debug(`request() [method:${request_1.Method[method]}]`);
        if (this.#closed) {
            throw new errors_1.InvalidStateError(`Channel closed, cannot send request [method:${request_1.Method[method]}]`);
        }
        if (this.#nextId < 4294967295) {
            ++this.#nextId;
        }
        else {
            this.#nextId = 1;
        }
        const id = this.#nextId;
        const handlerIdOffset = this.#bufferBuilder.createString(handlerId ?? '');
        let requestOffset;
        if (bodyType && bodyOffset) {
            requestOffset = request_1.Request.createRequest(this.#bufferBuilder, id, method, handlerIdOffset, bodyType, bodyOffset);
        }
        else {
            requestOffset = request_1.Request.createRequest(this.#bufferBuilder, id, method, handlerIdOffset, request_1.Body.NONE, 0);
        }
        const messageOffset = message_1.Message.createMessage(this.#bufferBuilder, message_1.Body.Request, requestOffset);
        // Finalizes the buffer and adds a 4 byte prefix with the size of the buffer.
        this.#bufferBuilder.finishSizePrefixed(messageOffset);
        // Create a new buffer with this data so multiple contiguous flatbuffers
        // do not point to the builder buffer overriding others info.
        const buffer = new Uint8Array(this.#bufferBuilder.asUint8Array());
        // Clear the buffer builder so it's reused for the next request.
        this.#bufferBuilder.clear();
        if (buffer.byteLength > MESSAGE_MAX_LEN) {
            throw new Error(`request too big [method:${request_1.Method[method]}]`);
        }
        // This may throw if closed or remote side ended.
        this.#producerSocket.write(buffer, 'binary');
        return new Promise((pResolve, pReject) => {
            const sent = {
                id: id,
                method: request_1.Method[method],
                resolve: data2 => {
                    if (!this.#sents.delete(id)) {
                        return;
                    }
                    pResolve(data2);
                },
                reject: error => {
                    if (!this.#sents.delete(id)) {
                        return;
                    }
                    pReject(error);
                },
                close: () => {
                    pReject(new errors_1.InvalidStateError(`Channel closed, pending request aborted [method:${request_1.Method[method]}, id:${id}]`));
                },
            };
            // Add sent stuff to the map.
            this.#sents.set(id, sent);
        });
    }
    processResponse(response) {
        const sent = this.#sents.get(response.id());
        if (!sent) {
            logger.error(`received response does not match any sent request [id:${response.id()}]`);
            return;
        }
        if (response.accepted()) {
            logger.debug(`request succeeded [method:${sent.method}, id:${sent.id}]`);
            sent.resolve(response);
        }
        else if (response.error()) {
            logger.warn(`request failed [method:${sent.method}, id:${sent.id}]: ${response.reason()}`);
            switch (response.error()) {
                case 'TypeError': {
                    sent.reject(new TypeError(response.reason()));
                    break;
                }
                default: {
                    sent.reject(new Error(response.reason()));
                }
            }
        }
        else {
            logger.error(`received response is not accepted nor rejected [method:${sent.method}, id:${sent.id}]`);
        }
    }
    processNotification(notification) {
        // Due to how Promises work, it may happen that we receive a response
        // from the worker followed by a notification from the worker. If we
        // emit the notification immediately it may reach its target **before**
        // the response, destroying the ordered delivery. So we must wait a bit
        // here.
        // See https://github.com/versatica/mediasoup/issues/510
        setImmediate(() => this.emit(notification.handlerId(), notification.event(), notification));
    }
    processLog(pid, log) {
        const logData = log.data();
        switch (logData[0]) {
            // 'D' (a debug log).
            case 'D': {
                logger.debug(`[pid:${pid}] ${logData.slice(1)}`);
                break;
            }
            // 'W' (a warn log).
            case 'W': {
                logger.warn(`[pid:${pid}] ${logData.slice(1)}`);
                break;
            }
            // 'E' (a error log).
            case 'E': {
                logger.error(`[pid:${pid}] ${logData.slice(1)}`);
                break;
            }
            // 'X' (a dump log).
            case 'X': {
                (0, node_console_1.info)(logData.slice(1));
                break;
            }
        }
    }
}
exports.Channel = Channel;
