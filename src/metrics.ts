import promClient, { Gauge } from "prom-client";
import url from "url";
import { TaskStatus } from "./spider";
export interface InitMetricsOption {
  node: string;
  appName: string;
  port: number;
}

export class MetricsController {
  statusGauge: Gauge | null = null
  timeCoustGauge: Gauge | null = null
  register: promClient.Registry | null = null
  option: InitMetricsOption | null = null
  init(option: InitMetricsOption) {
    this.option = option;
    const register = new promClient.Registry();
    register.setDefaultLabels({
      app: option.appName,
      node: option.node,
    });
    promClient.collectDefaultMetrics({ register });
    this.statusGauge = new promClient.Gauge({
      name: "spider_status",
      help: "爬虫数量状态",
      labelNames: ["status"],
    });
    this.timeCoustGauge = new promClient.Gauge({
      name: "spider_time_coust",
      help: "爬虫耗时",
    });
    register.registerMetric(this.statusGauge);
    this.register = register;
  }
  constructor(option: InitMetricsOption) {
    this.init(option);
  }
  setStatusGauge(status: TaskStatus, value: number) {
    this.statusGauge?.set({ status }, value);
  }
  setTimeCoustGauge(value: number) {
    this.timeCoustGauge?.set(value);
  }

  metrics() {
    return this.register?.metrics();
  }

  async listen() {
    const server = await import("http").then((m) => m.createServer(async (req, res) => {
      const route = url.parse(req?.url || "").pathname;
      if (route === "/metrics") {
        res.setHeader("Content-Type", this.register?.contentType || "");
        res.end(await this.metrics());
      }
    }));
    server.listen(this.option?.port);
    console.log("metrics listen on", this.option?.port);
  }
}

