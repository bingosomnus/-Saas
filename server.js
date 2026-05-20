import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { createPool } from 'mysql2/promise';

loadEnvFile();

const root = resolve('.');
const port = Number(process.env.PORT || 8000);
const tenantId = process.env.REPORT_TENANT_ID || 'TN002005';
const dbTenantCode = process.env.DB_TENANT_CODE || tenantId;

const pool = createPool({
  host: requiredEnv('DB_HOST'),
  port: Number(process.env.DB_PORT || 3306),
  database: requiredEnv('DB_DATABASE'),
  user: requiredEnv('DB_USER'),
  password: requiredEnv('DB_PASSWORD'),
  waitForConnections: true,
  connectionLimit: 5,
  namedPlaceholders: true,
  timezone: '+08:00'
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/api/dispatch-orders') {
      await handleDispatchOrders(url, res);
      return;
    }

    await serveStatic(url.pathname, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`Dispatch order report running at http://127.0.0.1:${port}/?tenantId=${tenantId}`);
});

async function handleDispatchOrders(url, res) {
  const requestTenantId = url.searchParams.get('tenantId') || tenantId;
  if (requestTenantId !== tenantId) {
    sendJson(res, 200, { rows: [] });
    return;
  }

  const sql = process.env.DISPATCH_ORDERS_SQL || defaultDispatchOrdersSql();
  const [rows] = await pool.execute(sql, { tenantId: dbTenantCode });
  const promotionLabels = await loadPromotionLabels(dbTenantCode);
  sendJson(res, 200, { rows: rows.map(row => normalizeRow(row, promotionLabels)) });
}

function defaultDispatchOrdersSql() {
  return `
    select
      o.tenant_code as tenantId,
      o.clue_code as leadId,
      o.created_by as leadOwner,
      o.dispatch_order_no as orderNo,
      coalesce(nullif(node.node_name, ''), statusNode.node_name, '') as status,
      o.dispatch_status as statusCode,
      o.created_date as createdAt,
      date_format(o.created_date, '%Y/%m/%d %H:%i') as createdAtText,
      o.category_name as category,
      concat_ws('-', nullif(o.first_class_channel_name, ''), nullif(o.second_class_channel_name, '')) as channel,
      o.shop_name as dispatchStore,
      o.customer_name as customerName,
      '' as phone,
      concat(o.province, o.city, o.region, o.street) as address,
      o.address as addressExtra,
      coalesce(nullif(ext.decorationCompanyName, ''), nullif(ext.decorationCompany, ''), '') as decorationCompany,
      coalesce(
        nullif(dept.dept_name, ''),
        nullif(o.dept_name, ''),
        case when ext.departmentCode = o.shop_code then nullif(o.shop_name, '') end,
        ''
      ) as department,
      coalesce(
        case ext.serviceShopCode
          when 'mkck' then '马可仓库店'
          when 'mkkx' then '马可凯旋店'
          else nullif(ext.serviceShopCode, '')
        end,
        ''
      ) as serviceStore,
      coalesce(ext.promotionActivityCode, '') as promotionActivityCode,
      case
        when nullif(ext.promotionActivityCode, '') is null then ''
        else coalesce(nullif(archivePromo.promotion, ''), nullif(promoLabel.promotion, ''), ext.promotionActivityCode, '')
      end as promotion,
      coalesce(ext.businessOwner, '') as businessOwner,
      coalesce(ext.salesOwner, nullif(o.share_clerk_realname, ''), nullif(o.created_by, ''), task.salesOwner, '') as salesOwner,
      coalesce(ext.surveyor, task.surveyor, '') as surveyor,
      coalesce(ext.designer, task.designer, '') as designer,
      case when coalesce(ext.wechatCount, 0) > 0 then 1 else 0 end as wechat,
      0 as \`group\`,
      case when coalesce(trade.receiptCount, 0) > 0 then 1 else 0 end as deposit,
      case when coalesce(ext.activeOrderCount, 0) > 0 then 1 else 0 end as deal,
      case when coalesce(shipments.shipmentCount, 0) > 0 then 1 else 0 end as shipment
    from sd_dispatch_order o
    left join sd_process_template_node node
      on node.is_deleted = 0
      and node.process_id = o.process_id
      and node.sub_status = o.dispatch_status
    left join (
      select
        sub_status,
        substring_index(group_concat(node_name order by nameCount desc, node_name separator '||'), '||', 1) as node_name
      from (
        select sub_status, node_name, count(*) as nameCount
        from sd_process_template_node
        where is_deleted = 0
          and nullif(node_name, '') is not null
        group by sub_status, node_name
      ) statusNames
      group by sub_status
    ) statusNode on statusNode.sub_status = o.dispatch_status
    left join (
      select
        business_key as dispatchOrderNo,
        max(case when business_type = 'decorationCompany' then value end) as decorationCompany,
        max(case when business_type = 'departmentCode' then value end) as departmentCode,
        max(case when business_type = 'serviceShopCode' then value end) as serviceShopCode,
        substring_index(group_concat(case
          when business_type = 'promotionActivityCode' then nullif(value, '')
        end order by updated_date desc, id desc separator '||'), '||', 1) as promotionActivityCode,
        max(case
          when business_type = 'decorationCompany' and value = 'KH160600565' then '上海统帅建筑装潢有限公司'
          when business_type = 'decorationCompany' and value = 'KH231208001' then '上海星杰设计装饰工程有限公司-甄选'
          when business_type = 'decorationCompany' and value = 'KH160600562' then '上海星杰设计装饰工程有限公司'
          when business_type = 'decorationCompany' and value = 'KH210104002' then '上海腾龙设计装潢有限公司'
          when business_type = 'decorationCompany' and value = 'KH160600568' then '上海百姓装潢有限公司'
          when business_type = 'decorationCompany' and value = 'KH190614004' then '上海云兰建筑装饰工程有限公司'
          when business_type = 'decorationCompany' and value = 'KH240917003' then '上海摩矩空间设计有限公司'
          when business_type = 'decorationCompany' and value = 'KH160600561' then '申远空间建筑装饰工程有限公司'
        end) as decorationCompanyName,
        group_concat(distinct case
          when business_type = 'dispatch_business'
          then coalesce(nullif(json_unquote(json_extract(value, '$.realname')), ''), search_value)
        end separator '、') as businessOwner,
        group_concat(distinct case
          when business_type = 'dispatch_merchandiser'
          then coalesce(nullif(json_unquote(json_extract(value, '$.realname')), ''), search_value)
        end separator '、') as salesOwner,
        group_concat(distinct case
          when business_type = 'dispatch_surveyor'
          then coalesce(nullif(json_unquote(json_extract(value, '$.realname')), ''), search_value)
        end separator '、') as surveyor,
        group_concat(distinct case
          when business_type = 'dispatch_designer'
          then coalesce(nullif(json_unquote(json_extract(value, '$.realname')), ''), search_value)
        end separator '、') as designer,
        sum(case
          when business_type = 'saas_pay'
            and json_valid(value)
            and nullif(json_unquote(json_extract(value, '$.outOrderCode')), '') is not null
            and coalesce(json_unquote(json_extract(value, '$.orderStatus')), '') <> '20'
            and coalesce(json_unquote(json_extract(value, '$.orderStatusLabel')), '') not like '%退%'
            and coalesce(json_unquote(json_extract(value, '$.orderStatusLabel')), '') not like '%取消%'
            and (
              json_unquote(json_extract(value, '$.orderStatus')) = '10'
              or json_unquote(json_extract(value, '$.orderStatusLabel')) = '已支付'
            )
          then 1 else 0
        end) as activeOrderCount,
        sum(case when business_type = 'wechat_id' then 1 else 0 end) as wechatCount
      from sd_dispatch_ext
      where is_deleted = 0
        and business_key in (
          select dispatch_order_no
          from sd_dispatch_order
          where is_deleted = 0 and tenant_code = :tenantId
        )
      group by business_key
    ) ext on ext.dispatchOrderNo = o.dispatch_order_no
    left join sd_shop_department dept
      on dept.is_deleted = 0
      and dept.tenant_code = o.tenant_code
      and dept.dept_code = ext.departmentCode
    left join (
      select
        dispatch_order_no as dispatchOrderNo,
        group_concat(distinct case
          when responsible_role = 'PG_Shop_Manager' or responsible_position = 'PG_Shop_Manager'
          then responsible_name
        end separator '、') as businessOwner,
        group_concat(distinct case
          when responsible_role = 'PG_Salse_Rose' or responsible_position = 'PG_Salse_Rose'
          then responsible_name
        end separator '、') as salesOwner,
        group_concat(distinct case
          when responsible_role = 'PG_Surveyo_Rose' or responsible_position = 'PG_Surveyo_Rose'
          then responsible_name
        end separator '、') as surveyor,
        group_concat(distinct case
          when responsible_role = 'PG_Designer_Rose' or responsible_position = 'PG_Designer_Rose'
          then responsible_name
        end separator '、') as designer
      from sd_task_record
      where is_deleted = 0
        and tenant_code = :tenantId
      group by dispatch_order_no
    ) task on task.dispatchOrderNo = o.dispatch_order_no
    left join (
      select
        dispatch_order_no as dispatchOrderNo,
        sum(case
          when advance_receipt_type in (1, 2)
            and opt_type = 1
            and invalid = 0
          then 1 else 0
        end) as receiptCount
      from sd_trade_record
      where is_deleted = 0
        and tenant_code = :tenantId
      group by dispatch_order_no
    ) trade on trade.dispatchOrderNo = o.dispatch_order_no
    left join (
      select
        dispatch_order_no as dispatchOrderNo,
        substring_index(group_concat(promotion order by updated_date desc, id desc separator '||'), '||', 1) as promotion
      from (
        select
          id,
          dispatch_order_no,
          updated_date,
          nullif(json_unquote(json_extract(param_json, '$.hdmc')), '') as promotion
        from sd_call_back_record
        where is_deleted = 0
          and tenant_code = :tenantId
          and json_valid(param_json)
      ) archivePromoRows
      where promotion is not null
      group by dispatch_order_no
    ) archivePromo on archivePromo.dispatchOrderNo = o.dispatch_order_no
    left join (
      select
        promotionCode,
        substring_index(group_concat(promotion order by updated_date desc, id desc separator '||'), '||', 1) as promotion
      from (
        select
          promoCode.value as promotionCode,
          callbackRows.id,
          callbackRows.updated_date,
          nullif(json_unquote(json_extract(callbackRows.param_json, '$.hdmc')), '') as promotion
        from sd_dispatch_ext promoCode
        join sd_call_back_record callbackRows
          on callbackRows.is_deleted = 0
          and callbackRows.tenant_code = :tenantId
          and callbackRows.dispatch_order_no = promoCode.business_key
          and json_valid(callbackRows.param_json)
        where promoCode.is_deleted = 0
          and promoCode.business_type = 'promotionActivityCode'
          and nullif(promoCode.value, '') is not null
      ) promoLabelRows
      where promotion is not null
      group by promotionCode
    ) promoLabel on promoLabel.promotionCode = ext.promotionActivityCode
    left join (
      select
        biz_order_code as dispatchOrderNo,
        count(*) as shipmentCount
      from sd_operation_log ship
      where ship.is_deleted = 0
        and ship.opt_type = 5400
        and ship.opt_log_name = '已发车'
        and not exists (
          select 1
          from sd_operation_log cancelLog
          where cancelLog.is_deleted = 0
            and cancelLog.biz_order_code = ship.biz_order_code
            and cancelLog.created_date >= ship.created_date
            and (
              cancelLog.opt_log_name like '%取消%'
              or cancelLog.opt_log_name like '%退%'
              or cancelLog.opt_remark like '%取消%'
              or cancelLog.opt_remark like '%退%'
            )
            and cancelLog.opt_remark like concat(
              '%',
              substring_index(substring_index(ship.opt_remark, '订单#（', -1), '）', 1),
              '%'
            )
        )
      group by biz_order_code
    ) shipments on shipments.dispatchOrderNo = o.dispatch_order_no
    where o.is_deleted = 0
      and o.tenant_code = :tenantId
    order by o.created_date desc
  `;
}

async function loadPromotionLabels(tenantCode) {
  const [rows] = await pool.execute(`
    select
      snapshot.dispatch_order_no as orderNo,
      snapshot.form_result as formResult
    from sd_custom_form_snapshot snapshot
    join sd_dispatch_order dispatchOrder
      on dispatchOrder.is_deleted = 0
      and dispatchOrder.dispatch_order_no = snapshot.dispatch_order_no
      and dispatchOrder.tenant_code = :tenantId
    where snapshot.is_deleted = 0
      and snapshot.form_name = '客户档案'
      and snapshot.form_result like '%promotionActivityCode%'
    order by snapshot.updated_date desc, snapshot.id desc
  `, { tenantId: tenantCode });

  const byOrder = new Map();
  const byCode = new Map();
  for (const row of rows) {
    const parsed = parsePromotionFromCustomerArchive(row.formResult);
    if (!parsed.code) continue;
    if (parsed.label) byCode.set(parsed.code, parsed.label);
    if (!byOrder.has(row.orderNo)) {
      byOrder.set(row.orderNo, parsed.label || parsed.code);
    }
  }
  return { byOrder, byCode };
}

function parsePromotionFromCustomerArchive(formResult) {
  try {
    const data = JSON.parse(formResult);
    const field = (data.form || []).find(item => item.fieldCode === 'promotionActivityCode');
    if (!field) return { code: '', label: '' };
    const code = stringValue(field.fieldValue);
    if (!code) return { code: '', label: '' };
    const option = (field.moduleConfigs || []).find(item => stringValue(item.value) === code);
    return { code, label: stringValue(option?.key) };
  } catch {
    return { code: '', label: '' };
  }
}

function stringValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  return String(value).trim();
}

function normalizeRow(row, promotionLabels = { byOrder: new Map(), byCode: new Map() }) {
  const createdAt = row.createdAt || row.created_at || row.createdAtText || row.created_at_text;
  const date = createdAt ? new Date(createdAt) : null;
  const orderNo = row.orderNo || row.order_no || '';
  const promotionCode = row.promotionActivityCode || row.promotion_activity_code || '';
  const promotion = promotionCode
    ? promotionLabels.byOrder.get(orderNo) || row.promotion || promotionLabels.byCode.get(promotionCode) || promotionCode
    : '';
  return {
    tenantId: row.tenantId || row.tenant_id || tenantId,
    leadId: row.leadId || row.lead_id || '',
    leadOwner: row.leadOwner || row.lead_owner || '',
    orderNo,
    status: row.status || '',
    statusCode: Number(row.statusCode ?? row.status_code ?? 0),
    createdAt: date ? date.toISOString() : '',
    createdAtText: row.createdAtText || row.created_at_text || formatDateTime(date),
    category: row.category || '',
    channel: row.channel || '',
    dispatchStore: row.dispatchStore || row.dispatch_store || '',
    customerName: row.customerName || row.customer_name || '',
    phone: row.phone || '',
    address: row.address || '',
    addressExtra: row.addressExtra || row.address_extra || '',
    decorationCompany: row.decorationCompany || row.decoration_company || '',
    department: row.department || '',
    serviceStore: row.serviceStore || row.service_store || '',
    promotion,
    businessOwner: row.businessOwner || row.business_owner || '',
    salesOwner: row.salesOwner || row.sales_owner || '',
    surveyor: row.surveyor || '',
    designer: row.designer || '',
    wechat: yesNo(row.wechat),
    group: yesNo(row.group),
    deposit: yesNo(row.deposit),
    deal: yesNo(row.deal),
    shipment: yesNo(row.shipment)
  };
}

async function serveStatic(pathname, res) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = resolve(join(root, safePath));
  if (!filePath.startsWith(root)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  const content = await readFile(filePath);
  res.writeHead(200, { 'Content-Type': mimeType(filePath) });
  res.end(content);
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sendText(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

function mimeType(filePath) {
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  }[extname(filePath)] || 'application/octet-stream';
}

function loadEnvFile() {
  const envPath = resolve('.env');
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function requiredEnv(key) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function yesNo(value) {
  if (value === true || value === 1 || value === '1' || value === '是') return '是';
  return '否';
}

function formatDateTime(date) {
  if (!date || Number.isNaN(date.getTime())) return '';
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
