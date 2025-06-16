import { Log } from '../../fbs/log/log';
import { Notification } from '../../fbs/notification/notification';
import { Request } from '../../fbs/request/request';
import { Response } from '../../fbs/response/response';
export declare enum Body {
    NONE = 0,
    Request = 1,
    Response = 2,
    Notification = 3,
    Log = 4
}
export declare function unionToBody(type: Body, accessor: (obj: Log | Notification | Request | Response) => Log | Notification | Request | Response | null): Log | Notification | Request | Response | null;
export declare function unionListToBody(type: Body, accessor: (index: number, obj: Log | Notification | Request | Response) => Log | Notification | Request | Response | null, index: number): Log | Notification | Request | Response | null;
//# sourceMappingURL=body.d.ts.map