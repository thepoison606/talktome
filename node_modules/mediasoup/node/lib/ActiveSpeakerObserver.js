"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActiveSpeakerObserverImpl = void 0;
const Logger_1 = require("./Logger");
const enhancedEvents_1 = require("./enhancedEvents");
const RtpObserver_1 = require("./RtpObserver");
const notification_1 = require("./fbs/notification");
const FbsActiveSpeakerObserver = require("./fbs/active-speaker-observer");
const logger = new Logger_1.Logger('ActiveSpeakerObserver');
class ActiveSpeakerObserverImpl extends RtpObserver_1.RtpObserverImpl {
    constructor(options) {
        const observer = new enhancedEvents_1.EnhancedEventEmitter();
        super(options, observer);
        this.handleWorkerNotifications();
        this.handleListenerError();
    }
    get type() {
        return 'activespeaker';
    }
    get observer() {
        return super.observer;
    }
    handleWorkerNotifications() {
        this.channel.on(this.internal.rtpObserverId, (event, data) => {
            switch (event) {
                case notification_1.Event.ACTIVESPEAKEROBSERVER_DOMINANT_SPEAKER: {
                    const notification = new FbsActiveSpeakerObserver.DominantSpeakerNotification();
                    data.body(notification);
                    const producer = this.getProducerById(notification.producerId());
                    if (!producer) {
                        break;
                    }
                    const dominantSpeaker = {
                        producer,
                    };
                    this.safeEmit('dominantspeaker', dominantSpeaker);
                    this.observer.safeEmit('dominantspeaker', dominantSpeaker);
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
exports.ActiveSpeakerObserverImpl = ActiveSpeakerObserverImpl;
