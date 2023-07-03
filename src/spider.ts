import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import iconv from "iconv-lite";
import cheerio, { CheerioAPI } from "cheerio"
import { MongoClient } from "mongodb";
import os from "node:os"
import { MetricsController } from "./metrics";

const sleep = (delay: number) => new Promise(resolve => setTimeout(resolve, delay));
const getConfigFromEnv = (name: string, defaultValue: string | number, isNumber = false) => isNumber ? Number(process.env[name.toUpperCase()]) : process.env[name.toUpperCase()] || defaultValue;


// 直接告诉爬虫任务的状态
export type TaskResult = {
  success: boolean;
  reason?: string;
  noRety?: boolean;
}

export interface FollowTaskPrarms {
  url: string;
  customCollection?: string;
  customDB?: string;
  customMongoClient?: MongoClient;
}

export interface SaveTaskPrarms {
  result: any;
  customCollection?: string;
  customDB?: string;
  customMongoClient?: MongoClient;
}

// 在每个 handle 中，告诉爬虫接下来怎么做。
export interface TaskHandlerParams {
  taskContext: TaskContext;
  save: (options: SaveTaskPrarms) => Promise<boolean>;
  follow: (options: FollowTaskPrarms) => Promise<boolean>;
  request: (config: AxiosRequestConfig) => Promise<AxiosResponse>;
  cheerio: CheerioAPI;
  convert: (buffer: Buffer, sourceEncoding: string) => string;
}

export type TaskStatus = "idle" | "success" | "failed" | "processing"

export interface Task {
  _id: any;
  status: TaskStatus;
  url: string;
  updatedAt: Date;
  createdAt: Date;
}

export interface CreateTaskDto {
  status: TaskStatus;
  url: string;
  updatedAt: Date;
  createdAt: Date;
  parentTaskId?: any;
  node: string;
}

export interface InitNodeSpiderOptions {
  sleep?: number;
  maxConnection?: number;
  maxRetry?: number;
  maxTimeout?: number;
  taskDB: string;
  // 任务搜集的集合
  taskCollection: string;
  // 需要处理的任务状态
  getTaskStatus?: string;
  // 保存的任务集合
  saveCollection: string;
  debug?: boolean;
  logFilter?: string | null;
  mongoUrl?: string;
  nodeName?: string;
  metrics?: boolean;
  metricsPort?: number;
  appName: string;
}

export interface NodeSpiderOptions {
  sleep: number;
  maxConnection: number;
  maxRetry: number;
  maxTimeout: number;
  taskDB: string;
  // 任务搜集的集合
  taskCollection: string;
  // 需要处理的任务状态
  getTaskStatus: string;
  // 保存的任务集合
  saveCollection: string;
  debug: boolean;
  logFilter: string | null;
  mongoUrl: string | null;
  nodeName: string;
  metrics: boolean;
  metricsPort: number;
  appName: string;
}

export type taskHandlerFn = (ctx: TaskHandlerParams) => Promise<TaskResult>;

export interface TaskCount {
  processing: number;
  success: number;
  failed: number;
  idle: number;
}

export class TaskContext {
  task: Task;
  startTime: Date | null = null;
  cost: number | null = null;
  constructor(task: Task) {
    this.task = task;
  }
  start() {
    this.startTime = new Date();
  }
  end() {
    if (!this.startTime) return 0;
    this.cost = new Date().getTime() - this.startTime!.getTime();
  }
  utilNow() {
    const cost = new Date().getTime() - this.startTime!.getTime();
    return cost;
  }
}

// 从某个任务来源拉取任务，然后执行任务，然后保存结果
export class TaskSpider {
  hasInited = false;
  taskHandler: taskHandlerFn | null = null;
  metricsController: MetricsController | null = null;
  taskCount: TaskCount = {
    processing: 0,
    success: 0,
    failed: 0,
    idle: 0,
  }

  options: NodeSpiderOptions = {
    sleep: 0,
    maxConnection: 10,
    maxRetry: 3,
    maxTimeout: 10 * 1000,
    taskCollection: "chapterTasks",
    getTaskStatus: "idle",
    saveCollection: "chapters",
    taskDB: "novel",
    debug: false,
    logFilter: null,
    mongoUrl: null,
    nodeName: os.hostname(),
    metrics: false,
    metricsPort: 9880,
    appName: "task-spider",
  }
  exiting = false;
  client: MongoClient | null = null;
  constructor(options: InitNodeSpiderOptions) {
    if (options) {
      this.options = {
        ...this.options,
        ...options,
      };
    }
    const envMongoUrl = process.env["MONGO_URL"];
    if (!this.options.mongoUrl) {
      if (envMongoUrl) this.options.mongoUrl = envMongoUrl;
      else throw new Error("mongoUrl is required");
    }
  }

  logWithTask(taskContext: TaskContext, ...args: any) {
    const task = taskContext.task;
    const taskPerfix = `[${task._id}][${task.status}][${task.url}][${taskContext.utilNow()}ms]`;
    this.log(taskPerfix, ...args);
  }

  log(...args: any) {
    const time = new Date().toLocaleString();
    const hostname = os.hostname();
    const prefix = `[${time}][${hostname}]`;

    if (args.some((arg: any) => {
      if (typeof arg === "string" && this.options.logFilter) {
        return arg.includes(this.options.logFilter);
      } else {
        return true;
      }
    })) {
      console.log(prefix, ...args);
    }

  }


  setAxios() {
    // 设置请求头 utf-8
    axios.defaults.headers.common['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7';
    axios.defaults.headers.common['Accept-Language'] = 'zh-CN,zh;q=0.9,en;q=0.8,zh-HK;q=0.7';
    // 最大超时
    axios.defaults.timeout = this.options.maxTimeout;
  }

  setExit() {
    process.on('unhandledRejection', (err) => {
      console.log('unhandledRejection', err);
      process.exit(1);
    });

    // 优雅退出
    process.on('SIGINT', async () => {
      console.log('SIGINT');
      this.exiting = true;
      await sleep(this.options.maxTimeout);
      await this.client?.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('SIGTERM');
      this.exiting = true;
      await sleep(this.options.maxTimeout);
      await this.client?.close();
      process.exit(0);
    });

    process.on('exit', async () => {
      console.log('exit');
      this.exiting = true;
      await sleep(this.options.maxTimeout);
      await this.client?.close();
      process.exit(0);
    });
  }

  async initDB() {
    const client = new MongoClient(this.options.mongoUrl as string);
    this.client = client;
    await this.connectDB();
  }

  async connectDB() {
    try {
      await this.client?.connect();
      this.log("数据库连接成功")
    } catch (err) {
      this.log(err)
    }
  }

  printConfig() {
    this.log("当前配置：", {
      ...this.options,
      mongoUrl: this.options.mongoUrl as string,
    });
  }

  async initMetrics() {
    if (!this.options.metrics) return;
    const metrics = new MetricsController({
      port: this.options.metricsPort,
      appName: this.options.appName,
      node: this.options.nodeName,
    });
    await metrics.listen();
    this.metricsController = metrics;
  }

  async init() {
    if (this.hasInited) return;
    if (!this.taskHandler) {
      throw new Error("taskHandler 方法未实现");
    }
    this.setAxios();
    this.setExit();
    this.printConfig();
    await this.initDB();
    await this.initMetrics();
    this.hasInited = true;
  }

  exit() {
    this.log("正在退出...，需要：", this.options.maxTimeout * 2, "ms")
    this.exiting = true;
    setTimeout(async () => {
      this.client?.close();
      process.exit(0);
    }, this.options.maxTimeout * 2);
  }

  async run() {
    await this.init();
    const runRecur = async () => {
      const shouldContinue = await this.processTask();
      if (this.exiting) {
        setTimeout(() => { }, this.options.maxTimeout * 2);
        return;
      }
      if (this.options.debug) {
        this.exit();
        return;
      }


      if (shouldContinue) {
        await sleep(this.options.sleep);
        await runRecur();
      }
    }
    if (this.options.debug) {
      runRecur();
      return;
    }
    for (let i = 0; i < this.options.maxConnection; i++) {
      runRecur();
    }
    this.exit();
  }

  async rollbackTask(taskContext: TaskContext, reason: string) {
    await this.updateStatus(taskContext, "failed", reason);
  }

  async processTask() {
    const task = await this.getOneTask();

    if (!task) {
      this.log("没有任务了，退出");
      return false;
    }
    const taskContext = new TaskContext(task);
    taskContext.start();
    this.logWithTask(taskContext, "获取到任务");
    const taskResult = await this.runTaskWithRetry(taskContext);
    if (!taskResult) {
      this.logWithTask(taskContext, "任务执行失败，这里按理说走不到的");
      await this.rollbackTask(taskContext, "走到了按理说走不到的地方");
      return true;
    } else {
      if (taskResult.success == false) {
        this.logWithTask(taskContext, "任务执行完成，此任务失败，更新任务状态");
        await this.updateStatus(taskContext, "failed", taskResult.reason);
        return true;
      }
      this.logWithTask(taskContext, "任务执行成功，更新任务状态");
      const success = await this.updateStatus(taskContext, "success");
      // 如果无法存库了，那就别继续了吧。
      return success;
    }
  }

  async execTask(taskContext: TaskContext): Promise<TaskResult> {
    this.logWithTask(taskContext, "开始执行任务");
    if (!this.taskHandler) {
      throw new Error("taskHandler 方法未实现");
    }
    try {
      const taskResult = await this.taskHandler({
        taskContext,
        save: async (options: SaveTaskPrarms) => {
          return await this.saveResult(taskContext, options)
        },
        follow: async (options: FollowTaskPrarms) => {
          return await this.followTask(taskContext, options);
        },
        request: this.request.bind(this),
        cheerio: cheerio,
        convert: (buffers: Buffer, sourceEncoding: string) => {
          return iconv.decode(buffers, sourceEncoding);
        }
      })
      return taskResult;
    } catch (err: any) {
      this.logWithTask(taskContext, "执行任务出错:", err);
      return {
        success: false,
        reason: err?.message
      };
    }
  }

  async request(config: AxiosRequestConfig) {
    const { url, ...rest } = config;
    const res = await axios.request({
      url,
      ...rest,
    });
    return res;
  }

  async addTask(options: FollowTaskPrarms) {
    if (!this.hasInited) await this.init();
    const { url } = options;
    try {
      const newTask: CreateTaskDto = {
        url,
        status: "idle",
        createdAt: new Date(),
        updatedAt: new Date(),
        node: this.options.nodeName,
      }
      const dstDB = options.customDB || this.options.taskDB;
      const dstCol = options.customCollection || this.options.taskCollection;
      const client = options.customMongoClient || this.client;
      if (!client) {
        throw new Error("client 不存在")
      }
      await client?.db(dstDB).collection(dstCol).insertOne(newTask);
      this.log("add task 成功")
      return true;
    }
    catch (err: any) {
      this.log("add task 失败", err)
      return false;
    }
  }


  async followTask(taskContext: TaskContext, options: FollowTaskPrarms) {
    if (!this.hasInited) await this.init();
    const { url } = options;
    try {
      const newTask: CreateTaskDto = {
        url,
        status: "idle",
        createdAt: new Date(),
        updatedAt: new Date(),
        parentTaskId: taskContext.task._id,
        node: this.options.nodeName,
      }
      const dstDB = options.customDB || this.options.taskDB;
      const dstCol = options.customCollection || this.options.taskCollection;
      const client = options.customMongoClient || this.client;
      await client?.db(dstDB).collection(dstCol).insertOne(newTask);
      this.logWithTask(taskContext, "follow next task 成功")
      return true;
    }
    catch (err: any) {
      await this.updateStatus(taskContext, "failed", "follow next task 失败" + err.message);
      this.logWithTask(taskContext, "follo next task 失败", err)
      return false;
    }
  }

  async saveResult(taskContext: TaskContext, options: SaveTaskPrarms) {
    if (!this.hasInited) await this.init();
    const { result } = options;
    try {
      const saveDto = {
        ...result,
        createdAt: new Date(),
        updatedAt: new Date(),
        taskId: taskContext.task._id,
      }
      const dstDB = options.customDB || this.options.taskDB;
      const dstCol = options.customCollection || this.options.saveCollection;
      const client = options.customMongoClient || this.client;
      await client?.db(dstDB).collection(dstCol).insertOne(saveDto);
      this.logWithTask(taskContext, "保存成功")
      return true;
    } catch (err: any) {
      await this.updateStatus(taskContext, "failed", "保存任务结果失败" + err.message);
      this.logWithTask(taskContext, "保存失败", err)
      return false;
    }
  }

  async updateStatus(taskContext: TaskContext, status: TaskStatus, errorMessage?: string | null | undefined) {
    if (!this.hasInited) await this.init();
    taskContext.end();
    try {
      await this.client?.db(this.options.taskDB).collection(this.options.taskCollection).updateOne(
        { _id: taskContext.task._id },
        errorMessage ? { $set: { status, errorMessage, node: this.options.nodeName, cost: taskContext.cost } } : { $set: { status, node: this.options.nodeName, cost: taskContext.cost } }
      );
      await this.setTaskCount(status, "add");
      if (taskContext.cost) {
        await this.metricsController?.setTimeCoustGauge(taskContext.cost);
      }
    } catch (err) {
      this.logWithTask(taskContext, "更新状态失败", err)
    }
  }

  async setTaskCount(status: TaskStatus, mode: "add" | "divide") {
    if (!this.hasInited) await this.init();
    try {
      if (mode === "add") {
        this.taskCount[status] += 1;
      } else {
        this.taskCount[status] -= 1;
      }
      await this.metricsController?.setStatusGauge(status, this.taskCount[status])
    } catch (err) {
      this.log("更新 task count 状态失败", err)
    }
  }

  async getOneTask(): Promise<Task | undefined | null> {
    const task = await this.client?.db(this.options.taskDB).collection(this.options.taskCollection).findOneAndUpdate(
      { status: this.options.getTaskStatus },
      { $set: { status: "processing", node: this.options.nodeName } }
    );
    if (!task?.value) return null;
    await this.setTaskCount("processing", "add");
    return task?.value as unknown as Task;
  }

  async runTaskWithRetry(taskContext: TaskContext, retryCount = 0): Promise<TaskResult> {
    if (retryCount > this.options.maxRetry) {
      this.logWithTask(taskContext, "重试次数超过最大限制，放弃重试");
      return {
        success: false,
        reason: "重试次数超过最大限制，放弃重试"
      };
    }
    const taskResult = await this.execTask(taskContext);
    if (taskResult.success) {
      this.logWithTask(taskContext, "执行任务成功");
      return taskResult;
    }
    if (taskResult.noRety) {
      this.logWithTask(taskContext, "执行任务失败，不重试");
      return taskResult
    }
    this.logWithTask(taskContext, `执行任务失败，开始第 ${retryCount + 1} 次重试`);
    await sleep(this.options.sleep);
    return this.runTaskWithRetry(taskContext, retryCount + 1);
  }
}



export default TaskSpider;

