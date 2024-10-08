import { LLM, message } from "@deskai/api";
import { ProxyAgent } from "undici";

const mapToObj = (map: Headers) => {
  const obj = {};
  Array.from(map.keys()).forEach((key) => {
    obj[key] = map.get(key);
  });
  return obj;
};

const commonHeaders = new Headers();
commonHeaders.append("Content-Type", "application/json");
export default class {
  proxyUrl: string;
  constructor() {
    this.proxyUrl = "";
    let botName = "GPT-4o-Mini";
    LLM.addLLMProvider({
      name: "Poe",
      currentModel: botName,
      description:
        "Poe lets you ask questions, get instant answers, and have back-and-forth conversations with AI.",
      configSchema: {
        type: "object",
        properties: {
          apiKey: {
            type: "string",
            title: "API Key",
            description: "Your Poe API Key",
          },
          botName: {
            type: "string",
            title: "Bot Name",
            description: "Input bot name to chat",
          },
          proxy: {
            type: "string",
            title: "Proxy",
            description: "Set proxy url.like: http://127.0.0.1:1234",
          },
        },
      },
      defaultConfig: {
        apiKey: "",
        botName: "GPT-4o-Mini",
      },
      icon: "https://psc2.cf2.poecdn.net/assets/favicon.svg",
      loadConfig: (config) => {
        botName = config.botName;
        this.proxyUrl = config.proxy;
        commonHeaders.delete("Authorization");
        commonHeaders.append("Authorization", `Bearer ${config.apiKey}`);
      },
      setConfig: (key, value) => {
        if (key === "Authorization") {
          commonHeaders.delete("Authorization");
          commonHeaders.append("Authorization", `Bearer ${value}`);
          return;
        }
        if (key === "botName") {
          botName = value;
          return;
        }
        if (key === "proxy") {
          this.proxyUrl = value;
          return;
        }
      },
      chat: async (content: message[], options: any) => {
        const baseContents: message[] = [];
        const tool_calls: any[] = [];
        const tool_results: any[] = [];
        content.forEach((c) => {
          if (c.role === "tool") {
            tool_results.push({
              role: "tool",
              name: tool_calls.find((item) => item.id === c.tool_call_id)
                ?.function.name,
              tool_call_id: c.tool_call_id,
              content: c.content,
            });
            return;
          }
          if (c.role === "assistant" && c.tool_calls?.length) {
            c.tool_calls.forEach((tool) => {
              tool_calls.push({
                id: tool.id,
                type: tool.type,
                function: tool.function,
              });
            });
            return;
          }
          baseContents.push(c);
        });
        const baseURL = `https://api.poe.com/bot/${botName}`;
        const stream = options?.stream ?? true;
        const response = await fetch(`${baseURL}`, {
          method: "POST",
          headers: commonHeaders,
          // @ts-ignore
          dispatcher: this.proxyUrl ? new ProxyAgent(this.proxyUrl) : undefined,
          body: JSON.stringify({
            version: "1.0",
            type: "query",
            query: baseContents.map((item) => ({
              role: item.role,
              sender_id: null,
              content: item.content,
              content_type: "text/markdown",
              timestamp: 0,
              message_id: "",
              feedback: [],
              attachments: [],
            })),
            user_id: "",
            conversation_id: "",
            message_id: "",
            metadata: "",
            api_key: "",
            access_key: "",
            temperature: 0.7,
            skip_system_prompt: false,
            logit_bias: {},
            stop_sequences: [],
            language_code: "en",
            tools: options?.tools,
            tool_calls: tool_calls.length ? tool_calls : undefined,
            tool_results: tool_results.length ? tool_results : undefined,
          }),
        });
        if (!response.ok) {
          if (response.status === 401) {
            throw new Error("Please config api key");
          }
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        const chunks: any = {
          role: "assistant",
          content: "",
        };
        return new Response(
          new ReadableStream({
            async start(controller) {
              const read = async () => {
                const { done, value } = await reader.read();
                let current = decoder.decode(value, { stream: true });
                current.split("\r\n").forEach((line) => {
                  if (!line || !line.startsWith("data:")) return;
                  if (line.startsWith("data:")) {
                    line = line.replace("data:", "");
                  }
                  line = line.trim();
                  if (line && line !== "[DONE]") {
                    try {
                      const messageObject = JSON.parse(line);
                      if (messageObject.text) {
                        chunks.content += messageObject.text;
                        if (stream) {
                          controller.enqueue(chunks);
                        }
                      } else if (messageObject?.choices?.length) {
                        if (messageObject.choices[0]?.delta?.tool_calls) {
                          if (!chunks.tool_calls) {
                            chunks.tool_calls =
                              messageObject.choices[0].delta.tool_calls;
                          } else {
                            messageObject.choices[0].delta.tool_calls.forEach(
                              (item) => {
                                chunks.tool_calls[
                                  item.index
                                ].function.arguments += item.function.arguments;
                              }
                            );
                          }
                        } else if (messageObject.choices[0].delta.content) {
                          chunks.content +=
                            messageObject.choices[0].delta.content;
                          if (stream) {
                            controller.enqueue(chunks);
                          }
                        }
                      }
                    } catch (e) {
                      console.log(line);
                      console.error(e);
                    }
                  }
                });
                if (done) {
                  if (chunks.tool_calls?.length) {
                    chunks.tool_calls.forEach((item) => {
                      if (typeof item.function?.arguments === "string") {
                        try {
                          item.function.arguments = JSON.parse(
                            item.function.arguments
                          );
                        } catch (e) {}
                      }
                    });
                    controller.enqueue(chunks);
                  }
                  controller.close();
                } else {
                  read();
                }
              };
              await read();
            },
          }),
          {
            headers: {
              ...mapToObj(response.headers),
              model: botName,
              "Content-Type": stream ? "text/event-stream" : "application/json",
            },
          }
        );
      },
    });
  }
}
