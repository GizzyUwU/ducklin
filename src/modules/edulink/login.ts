import type { LoginRequest, LoginResponse } from "./types/login.ts"
let cachedLoginData: { data: LoginResponse; date: number } | null = null;

export async function grabUser(
    identifier: string | number,
    username: string,
    password: string,
    url: string
): Promise<LoginResponse> {
    if (cachedLoginData && Date.now() - cachedLoginData.date < cachedLoginData.data.result.session.expires * 1000) {
        return cachedLoginData.data;
    }

    const loginResponse = await Bun.fetch(url + "/api/?method=EduLink.Login", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-API-Method": "EduLink.Login",
        },
        body: JSON.stringify(<LoginRequest>{
            jsonrpc: "2.0",
            method: "EduLink.Login",
            params: {
                from_app: false,
                fcm_token_old: "none",
                username,
                password,
                establishment_id: identifier?.toString(),
            },
            uuid: Bun.randomUUIDv7(),
            id: "1",
        }),
    });

    if (!loginResponse.ok) {
        console.error(
            "[ERROR] Failed to login! Status Code:",
            loginResponse.status,
            loginResponse.statusText
        );
        process.exit(1);
    }

    const loginData = (await loginResponse.json()) as LoginResponse;

    if (!loginData.result.success) {
        console.error("[ERROR] Failed to login! Error:", loginData.result.error);
        process.exit(1);
    }

    cachedLoginData = { data: loginData, date: Date.now() };

    return loginData;
}
