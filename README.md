# 派单列表

## 访问地址

本地调试地址：

```text
http://127.0.0.1:8000/?tenantId=TN002005
```

一期仅支持：

- 租户 ID：`TN002005`
- 租户名称：上海奥博贸易有限公司

传入其他 `tenantId` 时，页面会展示无数据提示。

## 已实现功能

- 免登录访问静态 HTML 报表。
- URL 参数按租户过滤：`tenantId=TN002005`。
- 派单时间范围筛选。
- 派单门店多选。
- 服务门店多选。
- 家装公司多选。
- 获客渠道多选。
- 派工单状态多选。
- 派工单号 / 手机号 / 客户姓名 / 线索 ID 关键词搜索。
- 搜索维度筛选：先选择是否加微 / 是否建群 / 是否收定 / 是否成交 / 是否发货，再选择筛选项全部 / 是 / 否。
- 仅保留明细数据区域，已移除指标卡片、趋势图和转化卡片。
- 明细表排序、分页、Excel 导出，导出前提示当前搜索结果总数并二次确认。

## 当前数据源

当前页面已预留后端接口接入，前端请求：

```text
GET /api/dispatch-orders?tenantId=TN002005
```

后端服务读取 `.env` 中的 MySQL 只读连接信息，并返回前端宽表结构。

本地启动前先安装依赖：

```bash
npm install
```

再复制 `.env.example` 为 `.env`，填写数据库只读连接信息和租户映射，启动：

```bash
npm run dev
```

```text
http://127.0.0.1:8000/?tenantId=TN002005
```

当前数据库里页面租户 `TN002005` 没有直接对应的派工单数据；马可波罗测试数据实际在 `tenant_code=mkblcz`。因此 `.env` 中使用：

```text
REPORT_TENANT_ID=TN002005
DB_TENANT_CODE=mkblcz
```

页面 URL 仍然使用 `tenantId=TN002005`，后端查询时映射到 `mkblcz`。

已接入字段来源与口径：

- 主表：`sd_dispatch_order`
- 角色人员：`sd_task_record`
- 家装公司、服务门店、促销活动固定字段、加微信、下单记录：`sd_dispatch_ext`
- 促销活动展示名兜底：`sd_custom_form_snapshot` 客户档案表单快照、`sd_call_back_record.param_json.hdmc`
- 收定/收款记录：`sd_trade_record`
- 发货记录：`sd_operation_log`
- 节点状态名称：`sd_process_template_node`

暂未完全接入的字段：

- 客户手机号：当前库中未发现派工单客户手机号字段。
- 是否建群：当前接口固定返回“否”，待确认企微建群关联表或稳定操作日志口径。

建议返回结构：

```json
{
  "rows": [
    {
      "tenantId": "TN002005",
      "leadId": "XS7453625359210053632",
      "leadOwner": "王海琼",
      "orderNo": "SD2605141112444661",
      "status": "跟进中",
      "createdAt": "2026-05-14T11:12:00+08:00",
      "createdAtText": "2026/05/14 11:12",
      "category": "瓷砖",
      "channel": "客户渠道-零售",
      "dispatchStore": "航头亿联店2025",
      "customerName": "20260517宋小兵",
      "phone": "196****7700",
      "address": "上海市上海市杨浦区平凉路街道",
      "addressExtra": "龙江路289弄10号201室",
      "decorationCompany": "无",
      "department": "航头亿联店2025",
      "serviceStore": "无",
      "promotion": "2026年51惠战51新",
      "businessOwner": "员工姓名",
      "salesOwner": "员工姓名",
      "surveyor": "员工姓名",
      "designer": "员工姓名",
      "wechat": "是",
      "group": "是",
      "deposit": "是",
      "deal": "是",
      "shipment": "否"
    }
  ]
}
```

切换正式接口时，在 `index.html` 中把 `DATA_SOURCE_MODE` 从 `mock` 改为接口模式，并保证接口字段与上面结构一致。

## 业务规则口径

- 部门：优先用 `sd_dispatch_ext.departmentCode` 映射 `sd_shop_department.dept_name`；映射不到时回退 `sd_dispatch_order.dept_name`；不再默认回退派单门店名称。
- 促销活动：以客户档案固定字段 `sd_dispatch_ext.business_type = 'promotionActivityCode'` 为准；字段为空则报表显示空。展示名只使用客户档案快照或回调字段映射，不从收款记录文本提取。
- 是否加微：任意员工加微，视为已加微。
- 是否建群：任意群关联该派工单，视为已建群。
- 是否收定：存在有效未撤回或取消的收定/收款记录，当前条件为 `sd_trade_record.advance_receipt_type in (1,2)`、`opt_type = 1`、`invalid = 0`。
- 是否成交：存在有效未退或取消的下单记录，当前条件为 `sd_dispatch_ext.business_type = 'saas_pay'` 且有有效 `outOrderCode`、状态为 `10/已支付`。
- 是否发货：存在有效未取消的“已发车”订单操作日志。

## 当前口径待修正字段

- 是否加微：当前只按 `sd_dispatch_ext.business_type = 'wechat_id'` 判断，会漏掉其他可能的添加微信来源。
- 是否建群：当前接口固定返回“否”，应补充企微群关联表或稳定操作日志判断。

## 待确认项

- 免登录链接下手机号是否必须持续脱敏。
- “有效收定金记录”“有效支付订单”的排除条件，例如作废、退款、取消订单。
- 正式上线时是否需要导出权限、访问白名单或链接有效期。
