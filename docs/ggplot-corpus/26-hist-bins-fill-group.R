# ggplot2 reference: geom_histogram — stacked by fill, bins
ggplot(diamonds, aes(price, fill = cut)) +
  geom_histogram(binwidth = 500)
