import * as flatbuffers from 'flatbuffers';
import { ConsumerLayers, ConsumerLayersT } from '../../fbs/consumer/consumer-layers';
export declare class LayersChangeNotification implements flatbuffers.IUnpackableObject<LayersChangeNotificationT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): LayersChangeNotification;
    static getRootAsLayersChangeNotification(bb: flatbuffers.ByteBuffer, obj?: LayersChangeNotification): LayersChangeNotification;
    static getSizePrefixedRootAsLayersChangeNotification(bb: flatbuffers.ByteBuffer, obj?: LayersChangeNotification): LayersChangeNotification;
    layers(obj?: ConsumerLayers): ConsumerLayers | null;
    static startLayersChangeNotification(builder: flatbuffers.Builder): void;
    static addLayers(builder: flatbuffers.Builder, layersOffset: flatbuffers.Offset): void;
    static endLayersChangeNotification(builder: flatbuffers.Builder): flatbuffers.Offset;
    static createLayersChangeNotification(builder: flatbuffers.Builder, layersOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): LayersChangeNotificationT;
    unpackTo(_o: LayersChangeNotificationT): void;
}
export declare class LayersChangeNotificationT implements flatbuffers.IGeneratedObject {
    layers: ConsumerLayersT | null;
    constructor(layers?: ConsumerLayersT | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=layers-change-notification.d.ts.map