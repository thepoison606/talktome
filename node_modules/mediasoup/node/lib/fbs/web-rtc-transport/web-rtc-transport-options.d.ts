import * as flatbuffers from 'flatbuffers';
import { Options, OptionsT } from '../../fbs/transport/options';
import { Listen } from '../../fbs/web-rtc-transport/listen';
import { ListenIndividualT } from '../../fbs/web-rtc-transport/listen-individual';
import { ListenServerT } from '../../fbs/web-rtc-transport/listen-server';
export declare class WebRtcTransportOptions implements flatbuffers.IUnpackableObject<WebRtcTransportOptionsT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): WebRtcTransportOptions;
    static getRootAsWebRtcTransportOptions(bb: flatbuffers.ByteBuffer, obj?: WebRtcTransportOptions): WebRtcTransportOptions;
    static getSizePrefixedRootAsWebRtcTransportOptions(bb: flatbuffers.ByteBuffer, obj?: WebRtcTransportOptions): WebRtcTransportOptions;
    base(obj?: Options): Options | null;
    listenType(): Listen;
    listen<T extends flatbuffers.Table>(obj: any): any | null;
    enableUdp(): boolean;
    enableTcp(): boolean;
    preferUdp(): boolean;
    preferTcp(): boolean;
    iceConsentTimeout(): number;
    static startWebRtcTransportOptions(builder: flatbuffers.Builder): void;
    static addBase(builder: flatbuffers.Builder, baseOffset: flatbuffers.Offset): void;
    static addListenType(builder: flatbuffers.Builder, listenType: Listen): void;
    static addListen(builder: flatbuffers.Builder, listenOffset: flatbuffers.Offset): void;
    static addEnableUdp(builder: flatbuffers.Builder, enableUdp: boolean): void;
    static addEnableTcp(builder: flatbuffers.Builder, enableTcp: boolean): void;
    static addPreferUdp(builder: flatbuffers.Builder, preferUdp: boolean): void;
    static addPreferTcp(builder: flatbuffers.Builder, preferTcp: boolean): void;
    static addIceConsentTimeout(builder: flatbuffers.Builder, iceConsentTimeout: number): void;
    static endWebRtcTransportOptions(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createWebRtcTransportOptions(builder: flatbuffers.Builder, baseOffset: flatbuffers.Offset, listenType: Listen, listenOffset: flatbuffers.Offset, enableUdp: boolean, enableTcp: boolean, preferUdp: boolean, preferTcp: boolean, iceConsentTimeout: number): flatbuffers.Offset;
    unpack(): WebRtcTransportOptionsT;
    unpackTo(_o: WebRtcTransportOptionsT): void;
}
export declare class WebRtcTransportOptionsT implements flatbuffers.IGeneratedObject {
    base: OptionsT | null;
    listenType: Listen;
    listen: ListenIndividualT | ListenServerT | null;
    enableUdp: boolean;
    enableTcp: boolean;
    preferUdp: boolean;
    preferTcp: boolean;
    iceConsentTimeout: number;
    constructor(base?: OptionsT | null, listenType?: Listen, listen?: ListenIndividualT | ListenServerT | null, enableUdp?: boolean, enableTcp?: boolean, preferUdp?: boolean, preferTcp?: boolean, iceConsentTimeout?: number);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=web-rtc-transport-options.d.ts.map