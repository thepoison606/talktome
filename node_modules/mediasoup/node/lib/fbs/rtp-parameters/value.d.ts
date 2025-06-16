import { Boolean } from '../../fbs/rtp-parameters/boolean';
import { Double } from '../../fbs/rtp-parameters/double';
import { Integer32 } from '../../fbs/rtp-parameters/integer32';
import { Integer32Array } from '../../fbs/rtp-parameters/integer32-array';
import { String } from '../../fbs/rtp-parameters/string';
export declare enum Value {
    NONE = 0,
    Boolean = 1,
    Integer32 = 2,
    Double = 3,
    String = 4,
    Integer32Array = 5
}
export declare function unionToValue(type: Value, accessor: (obj: Boolean | Double | Integer32 | Integer32Array | String) => Boolean | Double | Integer32 | Integer32Array | String | null): Boolean | Double | Integer32 | Integer32Array | String | null;
export declare function unionListToValue(type: Value, accessor: (index: number, obj: Boolean | Double | Integer32 | Integer32Array | String) => Boolean | Double | Integer32 | Integer32Array | String | null, index: number): Boolean | Double | Integer32 | Integer32Array | String | null;
//# sourceMappingURL=value.d.ts.map