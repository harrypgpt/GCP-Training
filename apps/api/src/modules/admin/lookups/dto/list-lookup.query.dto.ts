import { PaginationQueryDto } from '../../common/pagination.dto';

/** Plain pagination + search, reused as-is for every read-only lookup list
 * (no resource-specific filters — these are small, flat vocabularies). */
export class ListLookupQueryDto extends PaginationQueryDto {}
