# node-spider

一个通用的 nodejs 爬虫框架。

（自娱自乐）

## 安装
```bash
npm install node-spider
```

## 使用
```javascript

const {NodeSpider} = require('node-spider');

const spider = new NodeSpider({
    // 配置,具体看类型定义
});

spider.fetchUrlAndParse =  async (task) => {
    // 从 task.url 获取页面内容
    // 解析页面内容
    // 返回解析后的数据，没有的话返回空对象。
    // 报错的话就直接进入到错误队列
    return {
        // 解析后的数据
    }
}

spider.run();
```