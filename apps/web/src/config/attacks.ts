import { attackReportSchema } from "@tender/shared";
import recorded from "../data/attacks.json";

export const ATTACKS = attackReportSchema.parse(recorded);
// Evidence belongs to its recorded network, even when the app selects another network.
export const attackTransactionUrl = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;
export const attackRequestUrl = (id: number) => `https://testnet-api.outlayer.ai/attestations/by-request/${id}`;
