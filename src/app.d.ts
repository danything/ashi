/// <reference types="vite/client" />
import type { SessionUser } from "$lib/server/auth";

declare global {
	namespace App {
		interface Locals {
			user: SessionUser | null;
		}
	}
}
