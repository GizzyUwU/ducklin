import type { App } from "@slack/bolt";
import type { AchievementRequest, AchievementResponse } from "./types/achievement";
import { grabUser } from "../login";
import { DateTime } from "luxon";

export default async (app: App) => {
    const missingVars = [];
    if (!process.env.EDULINK_URL) missingVars.push("EDULINK_URL");
    if (!process.env.EDULINK_IDENTIFIER) missingVars.push("EDULINK_IDENTIFIER");
    if (!process.env.EDULINK_USERNAME) missingVars.push("EDULINK_USERNAME");
    if (!process.env.EDULINK_PASSWORD) missingVars.push("EDULINK_PASSWORD");

    if (missingVars.length > 0) {
        app.logger.warn("[EDULINK] Disabled due to missing environment variables:", missingVars.join(", "))
        return
    } else {
        async function grabAchievementAndPost() {
            const user = await grabUser(process.env.EDULINK_IDENTIFIER!, process.env.EDULINK_USERNAME!, process.env.EDULINK_PASSWORD!, process.env.EDULINK_URL!);

            const behaviourResponse = await Bun.fetch(process.env.EDULINK_URL + "/api/?method=EduLink.Achievement", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-API-Method": "EduLink.Achievement",
                    "Authorization": `Bearer ${user.result.authtoken}`
                },
                body: JSON.stringify(<AchievementRequest>{
                    jsonrpc: "2.0",
                    method: "EduLink.Achievement",
                    params: {
                        learner_id: Number(user.result.user.id)
                    },
                    uuid: Bun.randomUUIDv7(),
                    id: "1",
                }),
            });

            if (!behaviourResponse.ok) {
                console.error(
                    "[ERROR] Failed to login! Status Code:",
                    behaviourResponse.status,
                    behaviourResponse.statusText
                );
                process.exit(1);
            }

            const achievementData = (await behaviourResponse.json()) as AchievementResponse;

            if (!achievementData.result || !Array.isArray(achievementData.result.achievement)) {
                console.error("[EDULINK] Invalid achievement response:", achievementData);
                return;
            }

            const cacheFile = Bun.file("achievementCache.json");
            let cachedBehaviour: AchievementResponse.AchievementType[] = [];
            if (!await cacheFile.exists()) {
                await Bun.write("achievementCache.json", JSON.stringify(achievementData, null, 2));
                return;
            } else {
                const cache = await cacheFile.json()
                cachedBehaviour = cache.result.behaviour;
            }

            const newAchievements = achievementData.result.achievement.filter(
                (b: AchievementResponse.AchievementType) => !cachedBehaviour.some(c => c.id === b.id)
            );

            await Bun.write("achievementCache.json", JSON.stringify(achievementData, null, 2));

            if (newAchievements.length > 0) {
                const totalPoints = achievementData.result.achievement.reduce(
                    (sum, b) => sum + (Number(b.points) ?? 0),
                    0
                );

                app.client.chat.postMessage({ channel: String(process.env.CHANNEL), text: `Yipee new achievement points. Total Achievement Points ${totalPoints}` })
            }

            return;
        }

        grabAchievementAndPost();

        setTimeout(() => grabAchievementAndPost, 10 * 60 * 1000)
    }
};
