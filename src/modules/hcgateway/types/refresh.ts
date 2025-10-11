export type RefreshRequest = {
    refresh: string;
}

export type RefreshResponse = {
    token: string;
    refresh: string;
    expiry: string;
}