import { PickDto, Rule, RuleType, getSchema } from '@midwayjs/validate';

export class PrimeSyncItem {
  @Rule(RuleType.string().required())
  key: string;

  @Rule(RuleType.string().required())
  dataType: string;

  @Rule(RuleType.string().required())
  data: string;

  @Rule(RuleType.number().required())
  dataTimestamp: number;

  @Rule(RuleType.boolean().optional())
  isDeleted?: boolean;
}

export class ServerPrimeSyncItem extends PrimeSyncItem {
  // 以下是服务端所需属性, 客户端不关心
  @Rule(RuleType.string().optional())
  userId?: string;

  @Rule(RuleType.number().optional())
  nonce?: number;

  @Rule(RuleType.string().optional())
  pwdHash?: string;
}

export class PrimeSyncUploadItem extends PrimeSyncItem {}

export class PrimeSyncFlushRequestDTO {
  @Rule(RuleType.number().integer().required())
  nonce: number;

  // localData.length > 0, pwdhash 不能为 ''
  @Rule(RuleType.string().optional().allow('').empty(''))
  pwdHash: string;

  @Rule(getSchema(PrimeSyncUploadItem).optional())
  lock?: PrimeSyncUploadItem;

  @Rule(
    RuleType.array()
      .items(getSchema(PrimeSyncUploadItem))
      .when('pwdHash', {
        is: RuleType.string().not('').required(),
        then: RuleType.array().min(1),
        otherwise: RuleType.required(),
      })
  )
  localData: PrimeSyncUploadItem[];
}

export class PrimeChangeLockRequestDTO {
  @Rule(RuleType.string().required())
  pwdHash: string;

  @Rule(getSchema(PrimeSyncUploadItem).required())
  lock: PrimeSyncUploadItem;
}

export class PrimeSyncUploadRequestDTO {
  @Rule(RuleType.number().integer().required())
  nonce: number;

  @Rule(RuleType.string().required())
  pwdHash: string;

  @Rule(RuleType.array().items(getSchema(PrimeSyncUploadItem)).required())
  localData: PrimeSyncUploadItem[];
}

export class PrimeSyncUploadResponseDTO {
  @Rule(RuleType.number().required())
  created: number;

  @Rule(RuleType.number().required())
  updated: number;

  @Rule(RuleType.number().integer().required())
  nonce: number;

  @Rule(RuleType.string().required())
  pwdHash: string;
}

export class PrimeSyncDownloadRequestDTO {
  @Rule(RuleType.string().required())
  pwdHash: string;

  @Rule(RuleType.boolean().optional().default(false))
  includeDeleted?: boolean;

  @Rule(RuleType.number().optional())
  limit?: number;

  @Rule(RuleType.number().optional().default(0))
  skip?: number;
}

export class PrimeSyncDownloadResponseDTO {
  @Rule(RuleType.array().items(getSchema(PrimeSyncItem)))
  serverData: PrimeSyncItem[];
}

export class PrimeSyncCheckItem extends PickDto(PrimeSyncItem, [
  'key',
  'dataType',
]) {
  @Rule(RuleType.number().optional().allow(null))
  dataTimestamp?: number | null;
}

export class PrimeSyncCheckRequestDTO {
  @Rule(RuleType.number().integer().required())
  nonce: number;

  @Rule(RuleType.string().required())
  pwdHash: string;

  @Rule(RuleType.array().items(RuleType.string()).default([]))
  onlyCheckLocalDataType?: string[];

  @Rule(RuleType.array().items(getSchema(PrimeSyncCheckItem)).required())
  localData: PrimeSyncCheckItem[];
}

export class PrimeSyncCheckResponseDTO {
  @Rule(RuleType.number().optional())
  nonce?: number;

  @Rule(RuleType.array().items(RuleType.string()))
  deleted: string[];

  @Rule(RuleType.array().items(RuleType.string()))
  obsoleted: string[];

  // 以下需要返回具体的数据(客户端需要做更新)
  @Rule(RuleType.array().items(getSchema(PrimeSyncItem)))
  diff: PrimeSyncItem[];

  @Rule(RuleType.array().items(getSchema(PrimeSyncItem)))
  updated: PrimeSyncItem[];
}
