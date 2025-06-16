import * as flatbuffers from 'flatbuffers';
import { ActiveSpeakerObserverOptions, ActiveSpeakerObserverOptionsT } from '../../fbs/active-speaker-observer/active-speaker-observer-options';
export declare class CreateActiveSpeakerObserverRequest implements flatbuffers.IUnpackableObject<CreateActiveSpeakerObserverRequestT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): CreateActiveSpeakerObserverRequest;
    static getRootAsCreateActiveSpeakerObserverRequest(bb: flatbuffers.ByteBuffer, obj?: CreateActiveSpeakerObserverRequest): CreateActiveSpeakerObserverRequest;
    static getSizePrefixedRootAsCreateActiveSpeakerObserverRequest(bb: flatbuffers.ByteBuffer, obj?: CreateActiveSpeakerObserverRequest): CreateActiveSpeakerObserverRequest;
    rtpObserverId(): string | null;
    rtpObserverId(optionalEncoding: flatbuffers.Encoding): string | Uint8Array | null;
    options(obj?: ActiveSpeakerObserverOptions): ActiveSpeakerObserverOptions | null;
    static startCreateActiveSpeakerObserverRequest(builder: flatbuffers.Builder): void;
    static addRtpObserverId(builder: flatbuffers.Builder, rtpObserverIdOffset: flatbuffers.Offset): void;
    static addOptions(builder: flatbuffers.Builder, optionsOffset: flatbuffers.Offset): void;
    static endCreateActiveSpeakerObserverRequest(builder: flatbuffers.Builder): flatbuffers.Offset;
    unpack(): CreateActiveSpeakerObserverRequestT;
    unpackTo(_o: CreateActiveSpeakerObserverRequestT): void;
}
export declare class CreateActiveSpeakerObserverRequestT implements flatbuffers.IGeneratedObject {
    rtpObserverId: string | Uint8Array | null;
    options: ActiveSpeakerObserverOptionsT | null;
    constructor(rtpObserverId?: string | Uint8Array | null, options?: ActiveSpeakerObserverOptionsT | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=create-active-speaker-observer-request.d.ts.map