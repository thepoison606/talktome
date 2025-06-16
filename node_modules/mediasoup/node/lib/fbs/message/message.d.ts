import * as flatbuffers from 'flatbuffers';
import { LogT } from '../../fbs/log/log';
import { Body } from '../../fbs/message/body';
import { NotificationT } from '../../fbs/notification/notification';
import { RequestT } from '../../fbs/request/request';
import { ResponseT } from '../../fbs/response/response';
export declare class Message implements flatbuffers.IUnpackableObject<MessageT> {
    bb: flatbuffers.ByteBuffer | null;
    bb_pos: number;
    __init(i: number, bb: flatbuffers.ByteBuffer): Message;
    static getRootAsMessage(bb: flatbuffers.ByteBuffer, obj?: Message): Message;
    static getSizePrefixedRootAsMessage(bb: flatbuffers.ByteBuffer, obj?: Message): Message;
    dataType(): Body;
    data<T extends flatbuffers.Table>(obj: any): any | null;
    static startMessage(builder: flatbuffers.Builder): void;
    static addDataType(builder: flatbuffers.Builder, dataType: Body): void;
    static addData(builder: flatbuffers.Builder, dataOffset: flatbuffers.Offset): void;
    static endMessage(builder: flatbuffers.Builder): flatbuffers.Offset;
    static finishMessageBuffer(builder: flatbuffers.Builder, offset: flatbuffers.Offset): void;
    static finishSizePrefixedMessageBuffer(builder: flatbuffers.Builder, offset: flatbuffers.Offset): void;
    static createMessage(builder: flatbuffers.Builder, dataType: Body, dataOffset: flatbuffers.Offset): flatbuffers.Offset;
    unpack(): MessageT;
    unpackTo(_o: MessageT): void;
}
export declare class MessageT implements flatbuffers.IGeneratedObject {
    dataType: Body;
    data: LogT | NotificationT | RequestT | ResponseT | null;
    constructor(dataType?: Body, data?: LogT | NotificationT | RequestT | ResponseT | null);
    pack(builder: flatbuffers.Builder): flatbuffers.Offset;
}
//# sourceMappingURL=message.d.ts.map