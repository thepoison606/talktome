import * as flatbuffers from 'flatbuffers';
import { Score, ScoreT } from '../../fbs/producer/score';
export declare class ScoreNotification implements flatbuffers.IUnpackableObject<ScoreNotificationT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): ScoreNotification;
    static getRootAsScoreNotification(bb: flatbuffers.ByteBuffer, obj?: ScoreNotification): ScoreNotification;
    static getSizePrefixedRootAsScoreNotification(bb: flatbuffers.ByteBuffer, obj?: ScoreNotification): ScoreNotification;
    scores(index: number, obj?: Score): Score | null;
    scoresLength(): number;
    static startScoreNotification(builder: flatbuffers.Builder): void;
    static addScores(builder: flatbuffers.Builder, scoresOffset: flatbuffers.Offset): void;
    static createScoresVector(builder: flatbuffers.Builder, data: flatbuffers.Offset[]): flatbuffers.Offset;
    static startScoresVector(builder: flatbuffers.Builder, numElems: number): void;
    static endScoreNotification(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createScoreNotification(builder: flatbuffers.Builder, scoresOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): ScoreNotificationT;
    unpackTo(_o: ScoreNotificationT): void;
}
export declare class ScoreNotificationT implements flatbuffers.IGeneratedObject {
    scores: (ScoreT)[];
    constructor(scores?: (ScoreT)[]);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=score-notification.d.ts.map