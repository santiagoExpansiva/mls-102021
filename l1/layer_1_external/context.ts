/// <mls fileReference="_102021_/l1/layer_1_external/context.ts" enhancement="_blank" />

import { userDynamoDB } from "./dynamoDB/user.js";
import { userLocalDB } from "./localDB/user.js";
import { auditLocalDB } from "./localDB/audit.js";
import { Ctx } from "../common/local.js";
import { RequestBase } from "../global.js";

export function createContext(param: RequestBase): Ctx {

    if (!param.inDeveloped) throw new Error('Not implement api production');

    const ctx: Ctx = {

        io: {
            local: {
                user: userLocalDB,
                audit: auditLocalDB
            },
            dynamoDb: {
                user:userDynamoDB
            }
        }
    }

    return ctx;

}