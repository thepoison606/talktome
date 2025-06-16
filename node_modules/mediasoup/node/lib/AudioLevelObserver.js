"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AudioLevelObserverImpl = void 0;
const Logger_1 = require("./Logger");
const enhancedEvents_1 = require("./enhancedEvents");
const RtpObserver_1 = require("./RtpObserver");
const fbsUtils = require("./fbsUtils");
const notification_1 = require("./fbs/notification");
const FbsAudioLevelObserver = require("./fbs/audio-level-observer");
const logger = new Logger_1.Logger('AudioLevelObserver');
class AudioLevelObserverImpl extends RtpObserver_1.RtpObserverImpl {
    constructor(options) {
        const observer = new enhancedEvents_1.EnhancedEventEmitter();
        super(options, observer);
        this.handleWorkerNotifications();
        this.handleListenerError();
    }
    get type() {
        return 'audiolevel';
    }
    get observer() {
        return super.observer;
    }
    handleWorkerNotifications() {
        this.channel.on(this.internal.rtpObserverId, (event, data) => {
            switch (event) {
                case notification_1.Event.AUDIOLEVELOBSERVER_VOLUMES: {
                    const notification = new FbsAudioLevelObserver.VolumesNotification();
                    data.body(notification);
                    // Get the corresponding Producer instance and remove entries with
                    // no Producer (it may have been closed in the meanwhile).
                    const volumes = fbsUtils
                        .parseVector(notification, 'volumes', parseVolume)
                        .map(({ producerId, volume, }) => ({
                        producer: this.getProducerById(producerId),
                        volume,
                    }))
                        .filter(({ producer }) => producer);
                    if (volumes.length > 0) {
                        this.safeEmit('volumes', volumes);
                        // Emit observer event.
                        this.observer.safeEmit('volumes', volumes);
                    }
                    break;
                }
                case notification_1.Event.AUDIOLEVELOBSERVER_SILENCE: {
                    this.safeEmit('silence');
                    // Emit observer event.
                    this.observer.safeEmit('silence');
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
exports.AudioLevelObserverImpl = AudioLevelObserverImpl;
function parseVolume(binary) {
    return {
        producerId: binary.producerId(),
        volume: binary.volume(),
    };
}
