// The in-browser model's worker (Assistant, phase 5 wave 4): WebLLM
// runs the model here so the page stays responsive while it answers.
import { WebWorkerMLCEngineHandler } from "../vendor/webllm/web-llm-0.2.86.js";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => { handler.onmessage(msg); };
