import type { LoginRequest, LoginResponse } from "./types/login"
import type { RefreshRequest, RefreshResponse } from "./types/refresh"
let cachedLoginData: { data: LoginResponse; date: number } | null = null;

export async function grabUser(
    url: string,
    username: string,
    password: string,
): Promise<LoginResponse> {
    if (cachedLoginData) {
        const expiryTime = new Date(cachedLoginData.data.expiry).getTime();
        if (Date.now() >= expiryTime) {
            console.log("Login token expired. Refreshing...");
            const refreshResponse = await Bun.fetch(url + "/refresh", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(<RefreshRequest>{
                    refresh: cachedLoginData.data.refresh
                }),
            });
            if (!refreshResponse.ok) {
                throw new Error(
                    `[ERROR] Failed to refresh! Status Code: ${refreshResponse.status}, ${refreshResponse.statusText}`
                );
            }
            const refreshData = (await refreshResponse.json()) as RefreshResponse;
            cachedLoginData = { data: refreshData, date: Date.now() };

            return refreshData
        } else {
            return cachedLoginData.data;
        }
    }

    const loginResponse = await Bun.fetch(url + "/login", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(<LoginRequest>{
            username,
            password
        }),
    });

    if (!loginResponse.ok) {
        throw new Error(
            `[ERROR] Failed to login! Status Code: ${loginResponse.status} ${loginResponse.statusText}`,
        );
    }

    const loginData = (await loginResponse.json()) as LoginResponse;

    cachedLoginData = { data: loginData, date: Date.now() };

    return loginData;
}
