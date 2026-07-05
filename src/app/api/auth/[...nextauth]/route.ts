// Auth.js のHTTPエンドポイント（/api/auth/* を全部ここが処理する）
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
