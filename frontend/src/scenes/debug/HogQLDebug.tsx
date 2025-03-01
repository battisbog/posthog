import { BindLogic, useValues } from 'kea'
import { CodeEditor } from 'lib/components/CodeEditors'
import { CodeSnippet, Language } from 'lib/components/CodeSnippet'
import { LemonTable } from 'lib/lemon-ui/LemonTable'
import { Modifiers } from 'scenes/debug/Modifiers'

import { dataNodeLogic, DataNodeLogicProps } from '~/queries/nodes/DataNode/dataNodeLogic'
import { DateRange } from '~/queries/nodes/DataNode/DateRange'
import { ElapsedTime, Timings } from '~/queries/nodes/DataNode/ElapsedTime'
import { Reload } from '~/queries/nodes/DataNode/Reload'
import { EventPropertyFilters } from '~/queries/nodes/EventsNode/EventPropertyFilters'
import { HogQLQueryEditor } from '~/queries/nodes/HogQLQuery/HogQLQueryEditor'
import { DataNode, HogQLQuery, HogQLQueryResponse } from '~/queries/schema'

interface HogQLDebugProps {
    queryKey: string
    query: HogQLQuery
    setQuery: (query: DataNode) => void
}

function toLineColumn(hogql: string, position: number): { line: number; column: number } {
    const lines = hogql.split('\n')
    let line = 0
    let column = 0
    for (let i = 0; i < lines.length; i++) {
        if (position < lines[i].length) {
            line = i + 1
            column = position + 1
            break
        }
        position -= lines[i].length + 1
    }
    return { line, column }
}

function toLine(hogql: string, position: number): number {
    return toLineColumn(hogql, position).line
}

function toColumn(hogql: string, position: number): number {
    return toLineColumn(hogql, position).column
}

export function HogQLDebug({ query, setQuery, queryKey }: HogQLDebugProps): JSX.Element {
    const dataNodeLogicProps: DataNodeLogicProps = { query, key: queryKey, dataNodeCollectionId: queryKey }
    const {
        dataLoading,
        response: _response,
        responseErrorObject,
        elapsedTime,
    } = useValues(dataNodeLogic(dataNodeLogicProps))
    const response = _response as HogQLQueryResponse | null
    const clickHouseTime = response?.timings?.find(({ k }) => k === './clickhouse_execute')?.t

    return (
        <BindLogic logic={dataNodeLogic} props={dataNodeLogicProps}>
            <div className="space-y-2">
                <HogQLQueryEditor query={query} setQuery={setQuery} />
                <div className="flex gap-2">
                    <Reload />
                    <DateRange key="date-range" query={query} setQuery={setQuery} />
                    <EventPropertyFilters key="event-property" query={query} setQuery={setQuery} />
                </div>
                <Modifiers setQuery={setQuery} query={query} response={response} />
                {dataLoading ? (
                    <>
                        <h2>Running query...</h2>
                        <div className="flex">
                            Time elapsed: <ElapsedTime />
                        </div>
                    </>
                ) : (
                    <>
                        {response?.error ? (
                            <>
                                <h2 className="text-danger">Error Running Query!</h2>
                                <CodeSnippet language={Language.Text} wrap>
                                    {response.error}
                                </CodeSnippet>
                            </>
                        ) : null}
                        {response?.hogql ? (
                            <>
                                <h2>Executed HogQL</h2>
                                <CodeSnippet language={Language.SQL} wrap>
                                    {response.hogql}
                                </CodeSnippet>
                            </>
                        ) : null}
                        {response?.clickhouse ? (
                            <>
                                <h2>
                                    Executed ClickHouse SQL
                                    {clickHouseTime !== undefined
                                        ? ` (${Math.floor(clickHouseTime * 1000) / 1000}s)`
                                        : ''}
                                </h2>
                                <CodeSnippet language={Language.SQL} wrap>
                                    {response.clickhouse}
                                </CodeSnippet>
                            </>
                        ) : null}
                        {response?.metadata ? (
                            <>
                                <h2>Metadata</h2>
                                <LemonTable
                                    dataSource={[
                                        ...response.metadata.errors.map((error) => ({
                                            type: 'error',
                                            line: toLine(response.hogql ?? '', error.start ?? 0),
                                            column: toColumn(response.hogql ?? '', error.start ?? 0),
                                            ...error,
                                        })),
                                        ...response.metadata.warnings.map((warn) => ({
                                            type: 'warning',
                                            line: toLine(response.hogql ?? '', warn.start ?? 0),
                                            column: toColumn(response.hogql ?? '', warn.start ?? 0),
                                            ...warn,
                                        })),
                                        ...response.metadata.notices.map((notice) => ({
                                            type: 'notice',
                                            line: toLine(response.hogql ?? '', notice.start ?? 0),
                                            column: toColumn(response.hogql ?? '', notice.start ?? 0),
                                            ...notice,
                                        })),
                                    ].sort((a, b) => (a.start ?? 0) - (b.start ?? 0))}
                                    columns={[
                                        { title: 'Line', dataIndex: 'line', key: 'line', width: '40px' },
                                        { title: 'Column', dataIndex: 'column', key: 'column', width: '40px' },
                                        { title: 'Type', dataIndex: 'type', key: 'type', width: '80px' },
                                        { title: 'Message', dataIndex: 'message', key: 'message' },
                                    ]}
                                />
                            </>
                        ) : null}
                        {response?.explain ? (
                            <>
                                <h2>Explained ClickHouseSQL</h2>
                                <CodeSnippet wrap>{response.explain.join('\n')}</CodeSnippet>
                            </>
                        ) : null}
                        {response?.timings && elapsedTime !== null ? (
                            <>
                                <h2>Time spent</h2>
                                <Timings timings={response.timings} elapsedTime={elapsedTime} />
                            </>
                        ) : null}
                        <h2>Raw response</h2>
                        <CodeEditor
                            className="border"
                            language="json"
                            value={JSON.stringify(response ?? responseErrorObject, null, 2)}
                            height={800}
                        />
                    </>
                )}
            </div>
        </BindLogic>
    )
}
