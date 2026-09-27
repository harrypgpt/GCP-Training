import { PaginationQueryDto } from '../../common/pagination.dto';

/** Gate 10 §32/§50: paginated, structured section listing. `search`
 * (inherited) matches section identifier, heading, and exact content text -
 * never semantic/vector search. */
export class ListSourceSectionsQueryDto extends PaginationQueryDto {}
