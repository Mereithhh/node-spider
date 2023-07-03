import axios from "axios";
import { Axios } from "axios";
import iconv from "iconv-lite";
import cheerio from "cheerio"
import { MongoClient } from "mongodb";
import os from "node:os"

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
}

export interface SaveTaskPrarms {
  result: any;
  customCollection?: string;
  customDB?: string;
}

// 在每个 handle 中，告诉爬虫接下来怎么做。
export interface TaskContext {
  task: Task;
  save: (options: SaveTaskPrarms) => Promise<boolean>;
  follow: (options: FollowTaskPrarms) => Promise<boolean>;
}

export type TaskStatus = "idle" | "success" | "failed"

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
}

export interface NodeSpiderOptions {
  SLEEP: number;
  MAX_PROCESS: number;
  MAX_RETRY: number;
  MAX_TIMEOUT: number;
  taskDB: string;
  // 任务搜集的集合
  taskSouceCollection: string;
  // 需要处理的任务状态
  getTaskStatus: string;
  // 保存的任务集合
  saveCollection: string;
  debug: boolean;
  logFilter: string | null;
}

export type FetchUrlAndParseFuction = (task: TaskContext) => Promise<TaskResult>;

// 从某个任务来源拉取任务，然后执行任务，然后保存结果
export class NodeSpider {
  fetchUrlAndParse: FetchUrlAndParseFuction | null = null;
  options: NodeSpiderOptions = {
    SLEEP: 500,
    MAX_PROCESS: 10,
    MAX_RETRY: 3,
    MAX_TIMEOUT: 10 * 1000,
    taskSouceCollection: "chapterTasks",
    getTaskStatus: "idle",
    saveCollection: "chapters",
    taskDB: "novel",
    debug: false,
    logFilter: null,
  }
  exiting = false;
  client: MongoClient | null = null;
  mongoUrl = "mongodb://localhost:27017";
  constructor({ options, mongoUrl }: { options?: NodeSpiderOptions, mongoUrl?: string }) {
    if (options) {
      this.options = {
        ...this.options,
        ...options,
      };
    }
    if (mongoUrl) {
      this.mongoUrl = mongoUrl;
    }
  }

  logWithTask(task: Task, ...args: any) {
    const taskPerfix = `[${task._id}][${task.status}][${task.url}]`;
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
    axios.defaults.timeout = this.options.MAX_TIMEOUT;
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
      await sleep(this.options.MAX_TIMEOUT);
      await this.client?.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('SIGTERM');
      this.exiting = true;
      await sleep(this.options.MAX_TIMEOUT);
      await this.client?.close();
      process.exit(0);
    });

    process.on('exit', async () => {
      console.log('exit');
      this.exiting = true;
      await sleep(this.options.MAX_TIMEOUT);
      await this.client?.close();
      process.exit(0);
    });
  }

  async initDB() {
    const client = new MongoClient(this.mongoUrl);
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
      mongoUrl: this.mongoUrl
    });
  }

  async run() {
    if (!this.fetchUrlAndParse) {
      throw new Error("fetchUrlAndParse 方法未实现");
    }
    this.setAxios();
    this.setExit();
    this.printConfig();
    await this.initDB();
    const runRecur = async () => {
      const shouldContinue = await this.processTask();
      if (this.exiting) {
        setTimeout(() => { }, this.options.MAX_TIMEOUT * 2);
        return;
      }
      if (this.options.debug) {
        return;
      }


      if (shouldContinue) {
        await sleep(this.options.SLEEP);
        await runRecur();
      }
    }
    if (this.options.debug) {
      runRecur();
      return;
    }
    for (let i = 0; i < this.options.MAX_PROCESS; i++) {
      runRecur();
    }
  }

  async rollbackTask(task: Task, reason: string) {
    await this.updateStatus(task, "failed", reason);
  }

  async processTask() {
    const task = await this.getOneTask();

    if (!task) {
      this.log("没有任务了，退出");
      return false;
    }
    this.logWithTask(task, "获取到任务");
    const taskResult = await this.runTaskWithRetry(task);
    if (!taskResult) {
      this.logWithTask(task, "任务执行失败，这里按理说走不到的");
      await this.rollbackTask(task, "走到了按理说走不到的地方");
      return true;
    } else {
      if (taskResult.success == false) {
        this.logWithTask(task, "任务执行完成，此任务失败，更新任务状态");
        await this.updateStatus(task, "failed", taskResult.reason);
        return true;
      }
      this.logWithTask(task, "任务执行成功，更新任务状态");
      const success = await this.updateStatus(task, "success");
      // 如果无法存库了，那就别继续了吧。
      return success;
    }
  }

  async execTask(task: Task): Promise<TaskResult> {
    this.logWithTask(task, "开始执行任务");
    if (!this.fetchUrlAndParse) {
      throw new Error("fetchUrlAndParse 方法未实现");
    }
    try {
      const taskResult = await this.fetchUrlAndParse({
        task,
        save: async (options: SaveTaskPrarms) => {
          return await this.saveResult(task, options)
        },
        follow: async (options: FollowTaskPrarms) => {
          return await this.followTask(task, options);
        },
      })
      return taskResult;
    } catch (err: any) {
      this.logWithTask(task, "执行任务出错:", err);
      return {
        success: false,
        reason: err?.message
      };
    }
  }


  async followTask(task: Task, options: FollowTaskPrarms) {
    const { url } = options;
    try {
      const newTask: CreateTaskDto = {
        url,
        status: "idle",
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const dstDB = options.customDB || this.options.taskDB;
      const dstCol = options.customCollection || this.options.saveCollection;
      await this.client?.db(dstDB).collection(dstCol).insertOne(newTask);
      this.logWithTask(task, "follow next task 成功")
      return true;
    }
    catch (err: any) {
      await this.updateStatus(task, "failed", "follow next task 失败" + err.message);
      this.logWithTask(task, "follo next task 失败", err)
      return false;
    }
  }

  async saveResult(task: Task, options: SaveTaskPrarms) {
    const { result } = options;
    try {
      const saveDto = {
        ...result,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const dstDB = options.customDB || this.options.taskDB;
      const dstCol = options.customCollection || this.options.saveCollection;
      await this.client?.db(dstDB).collection(dstCol).insertOne(saveDto);
      this.logWithTask(task, "保存成功")
      return true;
    } catch (err: any) {
      await this.updateStatus(task, "failed", "保存任务结果失败" + err.message);
      this.logWithTask(task, "保存失败", err)
      return false;
    }
  }

  async updateStatus(task: Task, status: TaskStatus, errorMessage?: string | null | undefined) {
    try {
      await this.client?.db(this.options.taskDB).collection(this.options.taskSouceCollection).updateOne(
        { _id: task._id },
        errorMessage ? { $set: { status, errorMessage } } : { $set: { status } }
      );
    } catch (err) {
      this.logWithTask(task, "更新状态失败", err)
    }
  }

  async getOneTask(): Promise<Task | undefined | null> {
    const task = await this.client?.db(this.options.taskDB).collection(this.options.taskSouceCollection).findOneAndUpdate(
      { status: this.options.getTaskStatus },
      { $set: { status: "processing" } }
    );
    if (!task?.value) return null;

    return task?.value as unknown as Task;
  }

  async runTaskWithRetry(task: Task, retryCount = 0): Promise<TaskResult> {
    if (retryCount > this.options.MAX_RETRY) {
      this.logWithTask(task, "重试次数超过最大限制，放弃重试");
      return {
        success: false,
        reason: "重试次数超过最大限制，放弃重试"
      };
    }
    const taskResult = await this.execTask(task);
    if (taskResult.success) {
      this.logWithTask(task, "执行任务成功");
      return taskResult;
    }
    if (taskResult.noRety) {
      this.logWithTask(task, "执行任务失败，不重试");
      return taskResult
    }
    this.logWithTask(task, `执行任务失败，开始第 ${retryCount + 1} 次重试`);
    await sleep(this.options.SLEEP);
    return this.runTaskWithRetry(task, retryCount + 1);
  }
}



export default NodeSpider;

