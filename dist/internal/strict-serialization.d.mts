import * as Layer from "effect/Layer";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
/**
 * `Schema.toCodecJson(schema)` whose decoding refuses a key the schema does not declare, at
 * any depth, while encoding is unchanged.
 *
 * Effect's decoders strip excess keys unless the call passes `onExcessProperty: "error"`, and
 * an annotation cannot override a call's options; `RpcServer` decodes payloads with no options.
 * So the codec is a transformation from `unknown` whose decode re-enters the parser with the
 * caller's options plus `onExcessProperty: "error"`.
 */
export declare const strictCodecJson: RpcSerialization.CodecFor;
/**
 * {@link RpcSerialization.json} with {@link strictCodecJson}: a procedure refuses a payload
 * carrying a key its schema does not declare rather than running
 * with the key stripped. The refusal is a defect on that request's exit. Server side only:
 * clients encode from the payload's type, so they keep `RpcSerialization.layerJson`.
 */
export declare const layerStrictJson: Layer.Layer<RpcSerialization.RpcSerialization, never, never>;