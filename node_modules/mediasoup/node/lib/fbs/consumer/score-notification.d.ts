import * as flatbuffers from 'flatbuffers';
import { ConsumerScore, ConsumerScoreT } from '../../fbs/consumer/consumer-score';
export declare class ScoreNotification implements flatbuffers.IUnpackableObject<ScoreNotificationT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): ScoreNotification;
    static getRootAsScoreNotification(bb: flatbuffers.ByteBuffer, obj?: ScoreNotification): ScoreNotification;
    static getSizePrefixedRootAsScoreNotification(bb: flatbuffers.ByteBuffer, obj?: ScoreNotification): ScoreNotification;
    score(obj?: ConsumerScore): ConsumerScore | null;
    static startScoreNotification(builder: flatbuffers.Builder): void;
    static addScore(builder: flatbuffers.Builder, scoreOffset: flatbuffers.Offset): void;
    static endScoreNotification(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createScoreNotification(builder: flatbuffers.Builder, scoreOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): ScoreNotificationT;
    unpackTo(_o: ScoreNotificationT): void;
}
export declare class ScoreNotificationT implements flatbuffers.IGeneratedObject {
    score: ConsumerScoreT | null;
    constructor(score?: ConsumerScoreT | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=score-notification.d.ts.map