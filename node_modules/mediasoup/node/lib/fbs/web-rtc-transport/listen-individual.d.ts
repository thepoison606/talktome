import * as flatbuffers from 'flatbuffers';
import { ListenInfo, ListenInfoT } from '../../fbs/transport/listen-info';
export declare class ListenIndividual implements flatbuffers.IUnpackableObject<ListenIndividualT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): ListenIndividual;
    static getRootAsListenIndividual(bb: flatbuffers.ByteBuffer, obj?: ListenIndividual): ListenIndividual;
    static getSizePrefixedRootAsListenIndividual(bb: flatbuffers.ByteBuffer, obj?: ListenIndividual): ListenIndividual;
    listenInfos(index: number, obj?: ListenInfo): ListenInfo | null;
    listenInfosLength(): number;
    static startListenIndividual(builder: flatbuffers.Builder): void;
    static addListenInfos(builder: flatbuffers.Builder, listenInfosOffset: flatbuffers.Offset): void;
    static createListenInfosVector(builder: flatbuffers.Builder, data: flatbuffers.Offset[]): flatbuffers.Offset;
    static startListenInfosVector(builder: flatbuffers.Builder, numElems: number): void;
    static endListenIndividual(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createListenIndividual(builder: flatbuffers.Builder, listenInfosOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): ListenIndividualT;
    unpackTo(_o: ListenIndividualT): void;
}
export declare class ListenIndividualT implements flatbuffers.IGeneratedObject {
    listenInfos: (ListenInfoT)[];
    constructor(listenInfos?: (ListenInfoT)[]);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=listen-individual.d.ts.map