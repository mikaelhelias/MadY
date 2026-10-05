# ggplot2 reference: geom_histogram — facets + a lambda binwidth
ggplot(economics_long, aes(value)) +
  facet_wrap(~variable, scales = 'free_x') +
  geom_histogram(binwidth = \(x) 2 * IQR(x) / (length(x)^(1/3)))
