import { describe, expect, it } from "vitest";
import { createChironEndpoint, createChironMiddleware } from "./call";
import { toChironEndpoints } from "./to-chiron-endpoints";
import { init } from "../init";
import { z } from "zod";
import { APIError } from "better-call";

describe("before hook", async () => {
	describe("context", async () => {
		const endpoints = {
			query: createChironEndpoint(
				"/query",
				{
					method: "GET",
				},
				async (c) => {
					return c.query;
				}
			),
			body: createChironEndpoint(
				"/body",
				{
					method: "POST",
				},
				async (c) => {
					return c.body;
				}
			),
			params: createChironEndpoint(
				"/params",
				{
					method: "GET",
				},
				async (c) => {
					return c.params;
				}
			),
			headers: createChironEndpoint(
				"/headers",
				{
					method: "GET",
					requireHeaders: true,
				},
				async (c) => {
					return Object.fromEntries(c.headers.entries());
				}
			),
		};

		const authContext = init({
			authenticate: async () => {
				return {
					id: "1",
					status: "authenticated",
				};
			},
			hooks: {
				before: createChironMiddleware(async (c) => {
					switch (c.path) {
						case "/body":
							return {
								context: {
									body: {
										name: "body",
									},
								},
							};
						case "/params":
							return {
								context: {
									params: {
										name: "params",
									},
								},
							};
						case "/headers":
							return {
								context: {
									headers: new Headers({
										name: "headers",
									}),
								},
							};
					}
					return {
						context: {
							query: {
								name: "query",
							},
						},
					};
				}),
			},
		});
		const authEndpoints = toChironEndpoints(endpoints, authContext);

		it("should return hook set query", async () => {
			const res = await authEndpoints.query();
			expect(res?.name).toBe("query");
			const res2 = await authEndpoints.query({
				query: {
					key: "value",
				},
			});
			expect(res2).toMatchObject({
				name: "query",
				key: "value",
			});
		});

		it("should return hook set body", async () => {
			const res = await authEndpoints.body();
			expect(res?.name).toBe("body");
			const res2 = await authEndpoints.body({
				//@ts-expect-error
				body: {
					key: "value",
				},
			});
			expect(res2).toMatchObject({
				name: "body",
				key: "value",
			});
		});

		it("should return hook set param", async () => {
			const res = await authEndpoints.params();
			expect(res?.name).toBe("params");
			const res2 = await authEndpoints.params({
				params: {
					key: "value",
				},
			});
			expect(res2).toMatchObject({
				name: "params",
				key: "value",
			});
		});

		it("should return hook set headers", async () => {
			const res = await authEndpoints.headers({
				headers: new Headers({
					key: "value",
				}),
			});
			expect(res).toMatchObject({ key: "value", name: "headers" });
		});
	});

	describe("response", async () => {
		const endpoints = {
			response: createChironEndpoint(
				"/response",
				{
					method: "GET",
				},
				async (c) => {
					return { response: true };
				}
			),
			json: createChironEndpoint(
				"/json",
				{
					method: "GET",
				},
				async (c) => {
					return { response: true };
				}
			),
		};

		const authContext = init({
			authenticate: async () => {
				return {
					id: "1",
					status: "authenticated",
				};
			},
			hooks: {
				before: createChironMiddleware(async (c) => {
					if (c.path === "/json") {
						return { before: true };
					}
					return new Response(JSON.stringify({ before: true }));
				}),
			},
		});
		const authEndpoints = toChironEndpoints(endpoints, authContext);

		it("should return Response object", async () => {
			const response = await authEndpoints.response();
			expect(response).toBeInstanceOf(Response);
		});

		it("should return the hook response", async () => {
			const response = await authEndpoints.json();
			expect(response).toMatchObject({ before: true });
		});
	});
});

describe("after hook", async () => {
	describe("response", async () => {
		const endpoints = {
			changeResponse: createChironEndpoint(
				"/change-response",
				{
					method: "GET",
				},
				async (c) => {
					return {
						hello: "world",
					};
				}
			),
			throwError: createChironEndpoint(
				"/throw-error",
				{
					method: "POST",
					query: z
						.object({
							throwHook: z.boolean(),
						})
						.optional(),
				},
				async (c) => {
					throw c.error("BAD_REQUEST");
				}
			),
			multipleHooks: createChironEndpoint(
				"/multi-hooks",
				{
					method: "GET",
				},
				async (c) => {
					return {
						return: "1",
					};
				}
			),
		};

		const authContext = init({
			authenticate: async () => {
				return {
					id: "1",
					status: "authenticated",
				};
			},
			plugins: [
				{
					id: "test",
					hooks: {
						after: [
							{
								matcher() {
									return true;
								},
								handler: createChironMiddleware(async (c) => {
									if (c.path === "/multi-hooks") {
										return {
											return: "3",
										};
									}
								}),
							},
						],
					},
				},
			],
			hooks: {
				after: createChironMiddleware(async (c) => {
					if (c.path === "/change-response") {
						return {
							hello: "auth",
						};
					}
					if (c.path === "/multi-hooks") {
						return {
							return: "2",
						};
					}
					if (c.query?.throwHook) {
						throw c.error("BAD_REQUEST", {
							message: "from after hook",
						});
					}
				}),
			},
		});

		const api = toChironEndpoints(endpoints, authContext);

		it("should change the response object from `hello:world` to `hello:auth`", async () => {
			const response = await api.changeResponse();
			expect(response).toMatchObject({ hello: "auth" });
		});

		it("should return the last hook returned response", async () => {
			const response = await api.multipleHooks();
			expect(response).toMatchObject({
				return: "3",
			});
		});

		it("should return error as response", async () => {
			const response = await api.throwError({
				asResponse: true,
			});
			expect(response.status).toBe(400);
		});

		it("should throw the last error", async () => {
			await api
				.throwError({
					query: {
						throwHook: true,
					},
				})
				.catch((e) => {
					expect(e).toBeInstanceOf(APIError);
					expect(e?.message).toBe("from after hook");
				});
		});
	});

	describe("cookies", async () => {
		const endpoints = {
			cookies: createChironEndpoint(
				"/cookies",
				{
					method: "POST",
				},
				async (c) => {
					c.setCookie("session", "value");
					return { hello: "world" };
				}
			),
			cookieOverride: createChironEndpoint(
				"/cookie",
				{
					method: "GET",
				},
				async (c) => {
					c.setCookie("data", "1");
				}
			),
			noCookie: createChironEndpoint(
				"/no-cookie",
				{
					method: "GET",
				},
				async (c) => {}
			),
		};

		const authContext = init({
			authenticate: async () => {
				return {
					id: "1",
					status: "authenticated",
				};
			},
			hooks: {
				after: createChironMiddleware(async (c) => {
					c.setHeader("key", "value");
					c.setCookie("data", "2");
				}),
			},
		});

		const authEndpoints = toChironEndpoints(endpoints, authContext);

		it("set cookies from both hook", async () => {
			const result = await authEndpoints.cookies({
				asResponse: true,
			});
			expect(result.headers.get("set-cookie")).toContain("session=value");
			expect(result.headers.get("set-cookie")).toContain("data=2");
		});

		it("should override cookie", async () => {
			const result = await authEndpoints.cookieOverride({
				asResponse: true,
			});
			expect(result.headers.get("set-cookie")).toContain("data=2");
		});

		it("should only set the hook cookie", async () => {
			const result = await authEndpoints.noCookie({
				asResponse: true,
			});
			expect(result.headers.get("set-cookie")).toContain("data=2");
		});

		it("should return cookies from return headers", async () => {
			const result = await authEndpoints.noCookie({
				returnHeaders: true,
			});
			expect(result.headers.get("set-cookie")).toContain("data=2");

			const result2 = await authEndpoints.cookies({
				asResponse: true,
			});
			expect(result2.headers.get("set-cookie")).toContain("session=value");
			expect(result2.headers.get("set-cookie")).toContain("data=2");
		});
	});
});
