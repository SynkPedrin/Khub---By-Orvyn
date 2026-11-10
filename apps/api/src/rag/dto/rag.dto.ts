import { ArrayNotEmpty, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, Max } from 'class-validator';

const ESCOPOS = ['global', 'nicho', 'sub', 'tenant'] as const;

export class RegisterDocumentDto {
  @IsOptional()
  @IsString()
  nicho?: string;

  @IsOptional()
  @IsString()
  subespecialidade?: string;

  @IsString()
  @MaxLength(300)
  titulo!: string;

  @IsString()
  @MaxLength(120)
  fonte!: string;

  @IsOptional()
  @IsString()
  mime?: string;

  @IsString()
  @MaxLength(500_000)
  content!: string;
}

export class SearchDebugDto {
  @IsString()
  @MaxLength(1000)
  query!: string;

  @IsString()
  nicho!: string;

  @IsOptional()
  @IsString()
  subespecialidade?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(ESCOPOS as unknown as string[], { each: true })
  escopos?: string[];
}

export class FeedbackDto {
  @IsOptional()
  @IsUUID()
  queryId?: string;

  @IsString()
  @MaxLength(20_000)
  resposta!: string;

  @IsArray()
  @IsUUID('4', { each: true })
  chunkIds!: string[];

  @IsInt()
  @Min(-1)
  @Max(1)
  voto!: number;

  @IsOptional()
  @IsString()
  comentario?: string;
}
