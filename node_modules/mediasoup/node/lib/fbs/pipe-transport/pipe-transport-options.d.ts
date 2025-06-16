import * as flatbuffers from 'flatbuffers';
import { ListenInfo, ListenInfoT } from '../../fbs/transport/listen-info';
import { Options, OptionsT } from '../../fbs/transport/options';
export declare class PipeTransportOptions implements flatbuffers.IUnpackableObject<PipeTransportOptionsT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): PipeTransportOptions;
    static getRootAsPipeTransportOptions(bb: flatbuffers.ByteBuffer, obj?: PipeTransportOptions): PipeTransportOptions;
    static getSizePrefixedRootAsPipeTransportOptions(bb: flatbuffers.ByteBuffer, obj?: PipeTransportOptions): PipeTransportOptions;
    base(obj?: Options): Options | null;
    listenInfo(obj?: ListenInfo): ListenInfo | null;
    enableRtx(): boolean;
    enableSrtp(): boolean;
    static startPipeTransportOptions(builder: flatbuffers.Builder): void;
    static addBase(builder: flatbuffers.Builder, baseOffset: flatbuffers.Offset): void;
    static addListenInfo(builder: flatbuffers.Builder, listenInfoOffset: flatbuffers.Offset): void;
    static addEnableRtx(builder: flatbuffers.Builder, enableRtx: boolean): void;
    static addEnableSrtp(builder: flatbuffers.Builder, enableSrtp: boolean): void;
    static endPipeTransportOptions(builder: flatbuffers.Builder): flatbuffers.Offset;
    unpack(): PipeTransportOptionsT;
    unpackTo(_o: PipeTransportOptionsT): void;
}
export declare class PipeTransportOptionsT implements flatbuffers.IGeneratedObject {
    base: OptionsT | null;
    listenInfo: ListenInfoT | null;
    enableRtx: boolean;
    enableSrtp: boolean;
    constructor(base?: OptionsT | null, listenInfo?: ListenInfoT | null, enableRtx?: boolean, enableSrtp?: boolean);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=pipe-transport-options.d.ts.map