import * as flatbuffers from 'flatbuffers';
import { SrtpCryptoSuite } from '../../fbs/srtp-parameters/srtp-crypto-suite';
import { ListenInfo, ListenInfoT } from '../../fbs/transport/listen-info';
import { Options, OptionsT } from '../../fbs/transport/options';
export declare class PlainTransportOptions implements flatbuffers.IUnpackableObject<PlainTransportOptionsT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): PlainTransportOptions;
    static getRootAsPlainTransportOptions(bb: flatbuffers.ByteBuffer, obj?: PlainTransportOptions): PlainTransportOptions;
    static getSizePrefixedRootAsPlainTransportOptions(bb: flatbuffers.ByteBuffer, obj?: PlainTransportOptions): PlainTransportOptions;
    base(obj?: Options): Options | null;
    listenInfo(obj?: ListenInfo): ListenInfo | null;
    rtcpListenInfo(obj?: ListenInfo): ListenInfo | null;
    rtcpMux(): boolean;
    comedia(): boolean;
    enableSrtp(): boolean;
    srtpCryptoSuite(): SrtpCryptoSuite | null;
    static startPlainTransportOptions(builder: flatbuffers.Builder): void;
    static addBase(builder: flatbuffers.Builder, baseOffset: flatbuffers.Offset): void;
    static addListenInfo(builder: flatbuffers.Builder, listenInfoOffset: flatbuffers.Offset): void;
    static addRtcpListenInfo(builder: flatbuffers.Builder, rtcpListenInfoOffset: flatbuffers.Offset): void;
    static addRtcpMux(builder: flatbuffers.Builder, rtcpMux: boolean): void;
    static addComedia(builder: flatbuffers.Builder, comedia: boolean): void;
    static addEnableSrtp(builder: flatbuffers.Builder, enableSrtp: boolean): void;
    static addSrtpCryptoSuite(builder: flatbuffers.Builder, srtpCryptoSuite: SrtpCryptoSuite): void;
    static endPlainTransportOptions(builder: flatbuffers.Builder): flatbuffers.Offset;
    unpack(): PlainTransportOptionsT;
    unpackTo(_o: PlainTransportOptionsT): void;
}
export declare class PlainTransportOptionsT implements flatbuffers.IGeneratedObject {
    base: OptionsT | null;
    listenInfo: ListenInfoT | null;
    rtcpListenInfo: ListenInfoT | null;
    rtcpMux: boolean;
    comedia: boolean;
    enableSrtp: boolean;
    srtpCryptoSuite: SrtpCryptoSuite | null;
    constructor(base?: OptionsT | null, listenInfo?: ListenInfoT | null, rtcpListenInfo?: ListenInfoT | null, rtcpMux?: boolean, comedia?: boolean, enableSrtp?: boolean, srtpCryptoSuite?: SrtpCryptoSuite | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=plain-transport-options.d.ts.map