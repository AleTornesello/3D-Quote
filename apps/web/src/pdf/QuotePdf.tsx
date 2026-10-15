import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { QuotePdfData, QuotePdfRow } from './quote-pdf-data'

const GREY = '#6b7280'
const RULE = '#d1d5db'
const MM = 2.835

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: '#111827',
    paddingTop: 15 * MM,
    paddingHorizontal: 15 * MM,
    paddingBottom: 22 * MM,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  logo: { width: 40 * MM, height: 20 * MM, objectFit: 'contain', objectPosition: 'left' },
  shop: { alignItems: 'flex-end' },
  shopName: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  muted: { color: GREY },
  title: { fontSize: 20, fontFamily: 'Helvetica-Bold' },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  meta: { alignItems: 'flex-end' },
  client: { marginBottom: 16 },
  sectionTitle: { fontSize: 9, color: GREY, marginBottom: 3 },
  row: {
    flexDirection: 'row',
    paddingVertical: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: RULE,
  },
  head: { fontFamily: 'Helvetica-Bold', borderBottomWidth: 1, borderBottomColor: '#111827' },
  description: { flex: 4, paddingRight: 6 },
  material: { flex: 3, paddingRight: 6 },
  quantity: { flex: 1, textAlign: 'right' },
  unitPrice: { flex: 2, textAlign: 'right' },
  total: { flex: 2, textAlign: 'right' },
  totals: { marginTop: 10, alignSelf: 'flex-end', width: 70 * MM },
  totalLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  strong: { fontFamily: 'Helvetica-Bold', fontSize: 12 },
  block: { marginTop: 16 },
  terms: { fontSize: 8, color: GREY },
  footer: {
    position: 'absolute',
    bottom: 10 * MM,
    left: 15 * MM,
    right: 15 * MM,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 8,
    color: GREY,
  },
  watermark: {
    position: 'absolute',
    top: 330,
    left: 60,
    fontSize: 110,
    fontFamily: 'Helvetica-Bold',
    color: '#ececec',
    transform: 'rotate(-35deg)',
  },
})

function TableRow({
  values,
  head,
  fixed,
}: {
  values: QuotePdfRow
  head?: boolean
  fixed?: boolean
}) {
  return (
    <View style={head ? [styles.row, styles.head] : styles.row} wrap={false} fixed={fixed}>
      <Text style={styles.description}>{values.description}</Text>
      <Text style={styles.material}>{values.material}</Text>
      <Text style={styles.quantity}>{values.quantity}</Text>
      <Text style={styles.unitPrice}>{values.unitPrice}</Text>
      <Text style={styles.total}>{values.total}</Text>
    </View>
  )
}

/** The layout of a quote PDF (functional analysis §6). It prints `data` and decides nothing. */
export function QuotePdf({ data }: { data: QuotePdfData }) {
  return (
    <Document title={`${data.title} ${data.number}`} author={data.shop.name ?? undefined}>
      <Page size="A4" style={styles.page}>
        {data.watermark && (
          <Text style={styles.watermark} fixed>
            {data.watermark}
          </Text>
        )}
        <View style={styles.header}>
          {data.logo ? <Image src={data.logo} style={styles.logo} /> : <View />}
          <View style={styles.shop}>
            {data.shop.name && <Text style={styles.shopName}>{data.shop.name}</Text>}
            {data.shop.lines.map((line, index) => (
              <Text key={index} style={styles.muted}>
                {line}
              </Text>
            ))}
          </View>
        </View>

        <View style={styles.titleRow}>
          <Text style={styles.title}>
            {data.title} {data.number}
          </Text>
          <View style={styles.meta}>
            {data.meta.map((entry) => (
              <Text key={entry.label}>
                <Text style={styles.muted}>{entry.label}: </Text>
                {entry.value}
              </Text>
            ))}
          </View>
        </View>

        <View style={styles.client}>
          <Text style={styles.sectionTitle}>{data.client.title}</Text>
          {data.client.lines.map((line, index) => (
            <Text key={index}>{line}</Text>
          ))}
        </View>

        <View>
          <TableRow values={data.columns} head fixed />
          {data.rows.map((values, index) => (
            <TableRow key={index} values={values} />
          ))}
        </View>

        {data.consumables && (
          <View style={styles.block}>
            <Text style={styles.sectionTitle}>{data.consumables.title}</Text>
            <TableRow values={data.consumables.columns} head />
            {data.consumables.rows.map((values, index) => (
              <TableRow key={index} values={values} />
            ))}
          </View>
        )}

        <View style={styles.totals} wrap={false}>
          {data.totals.map((line) => (
            <View key={line.label} style={styles.totalLine}>
              <Text style={line.strong ? styles.strong : undefined}>{line.label}</Text>
              <Text style={line.strong ? styles.strong : undefined}>{line.value}</Text>
            </View>
          ))}
        </View>

        {data.notes && (
          <View style={styles.block} wrap={false}>
            <Text style={styles.sectionTitle}>{data.notes.title}</Text>
            <Text>{data.notes.text}</Text>
          </View>
        )}
        {data.terms && (
          <View style={styles.block}>
            <Text style={styles.terms}>{data.terms}</Text>
          </View>
        )}

        <View style={styles.footer} fixed>
          <Text>{data.footer.number}</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `${data.footer.page} ${pageNumber} ${data.footer.of} ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  )
}
